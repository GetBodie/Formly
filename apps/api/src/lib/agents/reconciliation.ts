import { prisma } from '../prisma.js'
import { generatePrepBrief } from '../openai.js'
import type { ChecklistItem, Document, Reconciliation } from '../../types.js'
import type { Document as PrismaDocument } from '@prisma/client'

export type ReconciliationTrigger = 'document_assessed' | 'manual_reconciliation' | 'check_completion'

function matchDocumentToItems(
  document: PrismaDocument,
  checklist: ChecklistItem[]
): string[] {
  const matchedItemIds: string[] = []

  for (const item of checklist) {
    if (item.expectedDocumentType &&
        item.expectedDocumentType.toLowerCase() === document.documentType.toLowerCase()) {
      matchedItemIds.push(item.id)
    }
  }

  return matchedItemIds
}

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
      completedWeight += weight * 0.5
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

function checkReady(
  checklist: ChecklistItem[],
  documents: PrismaDocument[],
  completionPercentage: number
): { isReady: boolean; reasons: string[] } {
  const highPriorityItems = checklist.filter(i => i.priority === 'high')
  const highPriorityComplete = highPriorityItems.every(i => i.status === 'complete')

  const documentsWithUnresolvedIssues = documents.filter(d =>
    d.issues && d.issues.length > 0 && !d.approvedAt
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

export async function runReconciliationAgent(context: {
  trigger: ReconciliationTrigger
  engagementId: string
  documentId?: string
  documentType?: string
}): Promise<{ isReady: boolean; completionPercentage: number }> {
  const { engagementId, documentId, documentType, trigger } = context

  console.log(`[RECONCILIATION] Starting ${trigger} for ${engagementId}`)

  const engagement = await prisma.engagement.findUnique({
    where: { id: engagementId },
    include: { documents: true }
  })

  if (!engagement) {
    throw new Error(`Engagement ${engagementId} not found`)
  }

  const checklist = (engagement.checklist as ChecklistItem[] | null) ?? []

  // Filter out archived documents (archivedAt !== null means archived)
  const documents = engagement.documents.filter(doc => !doc.archivedAt)

  if (checklist.length === 0) {
    console.log(`[RECONCILIATION] No checklist for ${engagementId}, skipping`)
    return { isReady: false, completionPercentage: 0 }
  }

  if (trigger === 'document_assessed' && documentId && documentType) {
    const doc = documents.find(d => d.id === documentId)

    if (doc) {
      const matchedItemIds = matchDocumentToItems(doc, checklist)

      for (const itemId of matchedItemIds) {
        const item = checklist.find(i => i.id === itemId)
        if (item) {
          if (!item.documentIds.includes(documentId)) {
            item.documentIds.push(documentId)
          }

          const hasIssues = doc.issues && doc.issues.length > 0 && !doc.approvedAt
          item.status = hasIssues ? 'received' : 'complete'

          console.log(`[RECONCILIATION] Matched ${documentType} to "${item.title}" -> ${item.status}`)
        }
      }

      await prisma.engagement.update({
        where: { id: engagementId },
        data: { checklist }
      })
    }
  }

  if (trigger === 'manual_reconciliation' || trigger === 'check_completion') {
    for (const item of checklist) {
      if (item.documentIds.length > 0) {
        const linkedDocs = documents.filter(d => item.documentIds.includes(d.id))
        const hasUnresolvedIssues = linkedDocs.some(d =>
          d.issues && d.issues.length > 0 && !d.approvedAt
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

  const { completionPercentage, itemStatuses } = calculateCompletion(checklist)
  const { isReady, reasons } = checkReady(checklist, documents, completionPercentage)

  const reconciliation: Reconciliation = {
    completionPercentage,
    itemStatuses,
    issues: reasons,
    ranAt: new Date().toISOString()
  }

  const updateData: Record<string, unknown> = {
    reconciliation,
    lastActivityAt: new Date()
  }

  if (isReady && engagement.status !== 'READY') {
    updateData.status = 'READY'
    console.log(`[RECONCILIATION] Transitioning ${engagementId} to READY`)

    try {
      const brief = await generatePrepBrief({
        clientName: engagement.clientName,
        taxYear: engagement.taxYear,
        checklist,
        documents: documents as unknown as Document[],
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
