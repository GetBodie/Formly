import { prisma } from '../prisma.js'
import { generatePrepBrief } from '../openai.js'
import type { Document, ChecklistItem, Reconciliation } from '../../types.js'

// Agent trigger types
export type ReconciliationTrigger = 'document_assessed' | 'manual_reconciliation' | 'check_completion'

/**
 * Match a document to checklist items based on expectedDocumentType.
 * Returns the IDs of matched items.
 */
function matchDocumentToItems(
  document: Document,
  checklist: ChecklistItem[]
): string[] {
  const matchedItemIds: string[] = []
  
  for (const item of checklist) {
    // Match if expectedDocumentType matches documentType exactly
    if (item.expectedDocumentType && 
        item.expectedDocumentType.toLowerCase() === document.documentType.toLowerCase()) {
      matchedItemIds.push(item.id)
    }
  }
  
  return matchedItemIds
}

/**
 * Calculate weighted completion percentage.
 * Weights: high=50%, medium=35%, low=15%
 */
function calculateCompletion(checklist: ChecklistItem[]): {
  completionPercentage: number
  itemStatuses: Array<{ itemId: string; status: 'pending' | 'received' | 'complete'; documentIds: string[] }>
} {
  if (checklist.length === 0) {
    return { completionPercentage: 0, itemStatuses: [] }
  }

  const weights: Record<string, number> = { high: 0.5, medium: 0.35, low: 0.15 }
  
  let totalWeight = 0
  let completedWeight = 0

  for (const item of checklist) {
    const weight = weights[item.priority] ?? 0.35
    totalWeight += weight

    if (item.status === 'complete') {
      completedWeight += weight
    } else if (item.status === 'received') {
      completedWeight += weight * 0.5 // Received = 50% credit
    }
  }

  const completionPercentage = totalWeight > 0
    ? Math.round((completedWeight / totalWeight) * 100)
    : 0

  const itemStatuses = checklist.map(item => ({
    itemId: item.id,
    status: item.status as 'pending' | 'received' | 'complete',
    documentIds: item.documentIds
  }))

  return { completionPercentage, itemStatuses }
}

/**
 * Check if engagement is ready for accountant.
 * Ready if: 100% complete OR all high-priority items done with no unresolved issues.
 */
function checkReady(
  checklist: ChecklistItem[],
  documents: Document[],
  completionPercentage: number
): { isReady: boolean; reasons: string[] } {
  const highPriorityItems = checklist.filter(i => i.priority === 'high')
  const highPriorityComplete = highPriorityItems.every(i => i.status === 'complete')

  // A document has unresolved issues if it has issues AND hasn't been approved
  const documentsWithUnresolvedIssues = documents.filter(d =>
    d.issues && d.issues.length > 0 && d.approved !== true
  )

  const isReady = (completionPercentage === 100) ||
    (highPriorityComplete && documentsWithUnresolvedIssues.length === 0)

  const reasons: string[] = []
  if (!isReady) {
    if (!highPriorityComplete) {
      reasons.push('Not all high-priority items are complete')
    }
    if (documentsWithUnresolvedIssues.length > 0) {
      reasons.push(`${documentsWithUnresolvedIssues.length} document(s) have unresolved issues`)
    }
    if (completionPercentage !== 100) {
      reasons.push(`Completion is ${completionPercentage}%, not 100%`)
    }
  }

  return { isReady, reasons }
}

/**
 * Run the Reconciliation Agent - matches documents to checklist items,
 * calculates completion, and determines if engagement is ready.
 * 
 * This is a direct implementation without the agent SDK.
 */
export async function runReconciliationAgent(context: {
  trigger: ReconciliationTrigger
  engagementId: string
  documentId?: string
  documentType?: string
}): Promise<{ isReady: boolean; completionPercentage: number }> {
  const { engagementId, documentId, documentType, trigger } = context

  console.log(`[RECONCILIATION] Starting ${trigger} for ${engagementId}`)

  const engagement = await prisma.engagement.findUnique({
    where: { id: engagementId }
  })

  if (!engagement) {
    throw new Error(`Engagement ${engagementId} not found`)
  }

  const checklist = (engagement.checklist as ChecklistItem[] | null) ?? []
  const allDocuments = (engagement.documents as Document[] | null) ?? []
  
  // Filter out archived documents
  const documents = allDocuments.filter(doc => !doc.archived)

  if (checklist.length === 0) {
    console.log(`[RECONCILIATION] No checklist for ${engagementId}, skipping`)
    return { isReady: false, completionPercentage: 0 }
  }

  // If triggered by a new document assessment, match it to checklist items
  if (trigger === 'document_assessed' && documentId && documentType) {
    const doc = documents.find(d => d.id === documentId)
    
    if (doc) {
      const matchedItemIds = matchDocumentToItems(doc, checklist)
      
      for (const itemId of matchedItemIds) {
        const item = checklist.find(i => i.id === itemId)
        if (item) {
          // Add document to item if not already there
          if (!item.documentIds.includes(documentId)) {
            item.documentIds.push(documentId)
          }
          
          // Update status based on whether doc has issues
          const hasIssues = doc.issues && doc.issues.length > 0 && doc.approved !== true
          item.status = hasIssues ? 'received' : 'complete'
          
          console.log(`[RECONCILIATION] Matched ${documentType} to "${item.title}" -> ${item.status}`)
        }
      }

      // Update checklist in DB
      await prisma.engagement.update({
        where: { id: engagementId },
        data: { checklist }
      })
    }
  }

  // For manual reconciliation or check_completion, review all items
  if (trigger === 'manual_reconciliation' || trigger === 'check_completion') {
    // Re-evaluate all items based on current documents
    for (const item of checklist) {
      if (item.documentIds.length > 0) {
        // Check if any linked document has issues
        const linkedDocs = documents.filter(d => item.documentIds.includes(d.id))
        const hasUnresolvedIssues = linkedDocs.some(d => 
          d.issues && d.issues.length > 0 && d.approved !== true
        )
        
        if (linkedDocs.length > 0) {
          item.status = hasUnresolvedIssues ? 'received' : 'complete'
        }
      }
    }

    await prisma.engagement.update({
      where: { id: engagementId },
      data: { checklist }
    })
  }

  // Calculate completion
  const { completionPercentage, itemStatuses } = calculateCompletion(checklist)

  // Check if ready
  const { isReady, reasons } = checkReady(checklist, documents, completionPercentage)

  // Build reconciliation record
  const reconciliation: Reconciliation = {
    completionPercentage,
    itemStatuses,
    issues: reasons,
    ranAt: new Date().toISOString()
  }

  // Update reconciliation and potentially status
  const updateData: Record<string, unknown> = {
    reconciliation,
    lastActivityAt: new Date()
  }

  // Auto-transition to READY if conditions met
  if (isReady && engagement.status !== 'READY') {
    updateData.status = 'READY'
    console.log(`[RECONCILIATION] Transitioning ${engagementId} to READY`)

    // Generate prep brief
    try {
      const brief = await generatePrepBrief({
        clientName: engagement.clientName,
        taxYear: engagement.taxYear,
        checklist,
        documents,
        reconciliation: {
          completionPercentage,
          issues: []
        }
      })
      updateData.prepBrief = brief
      console.log(`[RECONCILIATION] Generated prep brief for ${engagementId}`)
    } catch (error) {
      console.error(`[RECONCILIATION] Failed to generate prep brief:`, error)
    }
  }

  // Log agent activity
  const existingLog = (engagement.agentLog as object[] | null) ?? []
  const newEntry = {
    timestamp: new Date().toISOString(),
    agent: 'reconciliation',
    trigger,
    outcome: isReady ? 'ready' : `${completionPercentage}% complete`
  }
  updateData.agentLog = [...existingLog, newEntry]

  await prisma.engagement.update({
    where: { id: engagementId },
    data: updateData
  })

  console.log(`[RECONCILIATION] Completed ${trigger} for ${engagementId}. Ready: ${isReady}, Completion: ${completionPercentage}%`)

  return { isReady, completionPercentage }
}
