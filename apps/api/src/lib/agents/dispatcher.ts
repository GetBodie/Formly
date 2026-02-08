import { type AssessmentTrigger } from './assessment.js'
import { runAssessmentFast } from './assessment-fast.js'
import { runReconciliationAgent, type ReconciliationTrigger } from './reconciliation.js'
import { sendEmail, emailTemplates } from '../email.js'
import { prisma } from '../prisma.js'
import type { ChecklistItem } from '../../types.js'

// All possible event types
export type AgentEvent =
  | { type: 'engagement_created'; engagementId: string }
  | { type: 'intake_complete'; engagementId: string }
  | { type: 'document_uploaded'; engagementId: string; documentId: string; storageItemId: string; fileName: string }
  | { type: 'document_assessed'; engagementId: string; documentId: string; documentType: string; hasIssues: boolean }
  | { type: 'stale_engagement'; engagementId: string }
  | { type: 'check_completion'; engagementId: string }

// Dispatch an event to the appropriate agent(s)
export async function dispatch(event: AgentEvent): Promise<void> {
  console.log(`[DISPATCHER] Received event: ${event.type} for engagement ${event.engagementId}`)

  switch (event.type) {
    case 'engagement_created':
      // Send welcome email directly
      await sendWelcomeEmail(event.engagementId)
      break

    case 'intake_complete':
      // Send upload instructions directly
      await sendUploadInstructions(event.engagementId)
      break

    case 'document_uploaded': {
      // Always use fast assessment (no Claude agent overhead)
      const assessmentResult = await runAssessmentFast({
        engagementId: event.engagementId,
        documentId: event.documentId,
        storageItemId: event.storageItemId,
        fileName: event.fileName
      })

      // Chain to reconciliation after assessment
      await dispatch({
        type: 'document_assessed',
        engagementId: event.engagementId,
        documentId: event.documentId,
        documentType: assessmentResult.documentType,
        hasIssues: assessmentResult.hasIssues
      })
      break
    }

    case 'document_assessed':
      if (event.hasIssues) {
        // TODO: Send document issues email when needed
        console.log(`[DISPATCHER] Document ${event.documentId} has issues, skipping email for now`)
      } else {
        // Reconciliation Agent matches and checks completion
        const reconcileResult = await runReconciliationAgent({
          trigger: 'document_assessed',
          engagementId: event.engagementId,
          documentId: event.documentId,
          documentType: event.documentType
        })

        if (reconcileResult.isReady) {
          await sendCompletionEmails(event.engagementId)
        }
      }
      break

    case 'stale_engagement':
      // TODO: Send reminder email when needed
      console.log(`[DISPATCHER] Stale engagement ${event.engagementId}, skipping reminder for now`)
      break

    case 'check_completion': {
      // Reconciliation Agent checks if ready
      const checkResult = await runReconciliationAgent({
        trigger: 'check_completion',
        engagementId: event.engagementId
      })

      if (checkResult.isReady) {
        await sendCompletionEmails(event.engagementId)
      }
      break
    }

    default:
      console.warn(`[DISPATCHER] Unknown event type: ${(event as { type: string }).type}`)
  }
}

// Helper functions for direct email sending

async function sendWelcomeEmail(engagementId: string): Promise<void> {
  const engagement = await prisma.engagement.findUnique({ where: { id: engagementId } })
  if (!engagement) {
    console.error(`[EMAIL] Engagement not found: ${engagementId}`)
    return
  }

  const engagementData = {
    id: engagement.id,
    clientName: engagement.clientName,
    clientEmail: engagement.clientEmail,
    taxYear: engagement.taxYear,
    typeformFormId: engagement.typeformFormId,
    storageFolderUrl: engagement.storageFolderUrl,
  }

  try {
    const template = emailTemplates.welcome(engagementData)
    await sendEmail(engagement.clientEmail, template)
    await prisma.engagement.update({
      where: { id: engagementId },
      data: { lastActivityAt: new Date() }
    })
    console.log(`[EMAIL] Welcome email sent to ${engagement.clientEmail}`)
  } catch (error) {
    console.error(`[EMAIL] Failed to send welcome email:`, error)
  }
}

async function sendUploadInstructions(engagementId: string): Promise<void> {
  const engagement = await prisma.engagement.findUnique({ where: { id: engagementId } })
  if (!engagement) {
    console.error(`[EMAIL] Engagement not found: ${engagementId}`)
    return
  }

  const engagementData = {
    id: engagement.id,
    clientName: engagement.clientName,
    clientEmail: engagement.clientEmail,
    taxYear: engagement.taxYear,
    typeformFormId: engagement.typeformFormId,
    storageFolderUrl: engagement.storageFolderUrl,
    checklist: engagement.checklist as ChecklistItem[] | null,
  }

  try {
    const template = emailTemplates.sharepoint_instructions(engagementData)
    await sendEmail(engagement.clientEmail, template)
    await prisma.engagement.update({
      where: { id: engagementId },
      data: { lastActivityAt: new Date() }
    })
    console.log(`[EMAIL] Upload instructions sent to ${engagement.clientEmail}`)
  } catch (error) {
    console.error(`[EMAIL] Failed to send upload instructions:`, error)
  }
}

async function sendCompletionEmails(engagementId: string): Promise<void> {
  const engagement = await prisma.engagement.findUnique({ where: { id: engagementId } })
  if (!engagement) {
    console.error(`[EMAIL] Engagement not found: ${engagementId}`)
    return
  }

  const engagementData = {
    id: engagement.id,
    clientName: engagement.clientName,
    clientEmail: engagement.clientEmail,
    taxYear: engagement.taxYear,
    typeformFormId: engagement.typeformFormId,
    storageFolderUrl: engagement.storageFolderUrl,
  }

  try {
    // Send completion email to client
    const clientTemplate = emailTemplates.complete(engagementData)
    await sendEmail(engagement.clientEmail, clientTemplate)
    console.log(`[EMAIL] Completion email sent to ${engagement.clientEmail}`)

    // Send notification to accountant
    const accountantEmail = process.env.ACCOUNTANT_EMAIL
    if (accountantEmail) {
      const accountantTemplate = emailTemplates.accountant_notification(engagementData)
      await sendEmail(accountantEmail, accountantTemplate)
      console.log(`[EMAIL] Accountant notification sent to ${accountantEmail}`)
    }

    await prisma.engagement.update({
      where: { id: engagementId },
      data: { lastActivityAt: new Date() }
    })
  } catch (error) {
    console.error(`[EMAIL] Failed to send completion emails:`, error)
  }
}

// Export individual agent runners for direct use
export { runReconciliationAgent }
export type { AssessmentTrigger, ReconciliationTrigger }
