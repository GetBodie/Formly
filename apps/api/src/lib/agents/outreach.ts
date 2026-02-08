import { prisma } from '../prisma.js'
import { sendEmail, emailTemplates } from '../email.js'
import type { ChecklistItem, Reconciliation } from '../../types.js'

// Agent trigger types
export type OutreachTrigger =
  | 'engagement_created'
  | 'intake_complete'
  | 'stale_engagement'
  | 'document_issues'
  | 'engagement_complete'

/**
 * Run the Outreach Agent - sends emails based on engagement events.
 * 
 * This is a direct implementation without the agent SDK.
 * The dispatcher now handles most email sending directly, so this
 * function is mainly for manual/programmatic triggering.
 */
export async function runOutreachAgent(context: {
  trigger: OutreachTrigger
  engagementId: string
  additionalContext?: Record<string, unknown>
}): Promise<void> {
  const { trigger, engagementId, additionalContext } = context

  console.log(`[OUTREACH] Starting ${trigger} for ${engagementId}`)

  const engagement = await prisma.engagement.findUnique({
    where: { id: engagementId }
  })

  if (!engagement) {
    throw new Error(`Engagement ${engagementId} not found`)
  }

  const engagementData = {
    id: engagement.id,
    clientName: engagement.clientName,
    clientEmail: engagement.clientEmail,
    taxYear: engagement.taxYear,
    typeformFormId: engagement.typeformFormId,
    storageFolderUrl: engagement.storageFolderUrl,
    checklist: engagement.checklist as ChecklistItem[] | null
  }

  try {
    switch (trigger) {
      case 'engagement_created': {
        const template = emailTemplates.welcome(engagementData)
        await sendEmail(engagement.clientEmail, template)
        console.log(`[OUTREACH] Sent welcome email to ${engagement.clientEmail}`)
        break
      }

      case 'intake_complete': {
        const template = emailTemplates.sharepoint_instructions(engagementData)
        await sendEmail(engagement.clientEmail, template)
        console.log(`[OUTREACH] Sent upload instructions to ${engagement.clientEmail}`)
        break
      }

      case 'stale_engagement': {
        // Get missing items for reminder
        const checklist = (engagement.checklist as ChecklistItem[] | null) ?? []
        const reconciliation = engagement.reconciliation as Reconciliation | null
        
        const statusMap = new Map<string, string>()
        if (reconciliation?.itemStatuses) {
          for (const status of reconciliation.itemStatuses) {
            statusMap.set(status.itemId, status.status)
          }
        }

        const missingItems = checklist
          .filter(item => {
            const status = statusMap.get(item.id) ?? item.status
            return status !== 'complete'
          })
          .map(item => ({ id: item.id, title: item.title }))

        if (missingItems.length > 0 && engagement.reminderCount < 5) {
          const template = emailTemplates.reminder(engagementData, missingItems)
          await sendEmail(engagement.clientEmail, template)
          
          await prisma.engagement.update({
            where: { id: engagementId },
            data: {
              reminderCount: { increment: 1 },
              lastReminderAt: new Date()
            }
          })
          console.log(`[OUTREACH] Sent reminder #${engagement.reminderCount + 1} to ${engagement.clientEmail}`)
        }
        break
      }

      case 'document_issues': {
        const issues = (additionalContext?.issues as Array<{ fileName: string; problem: string }>) ?? []
        if (issues.length > 0) {
          const template = emailTemplates.document_issue(engagementData, issues)
          await sendEmail(engagement.clientEmail, template)
          console.log(`[OUTREACH] Sent issue notification for ${issues.length} document(s)`)
        }
        break
      }

      case 'engagement_complete': {
        // Send completion email to client
        const clientTemplate = emailTemplates.complete(engagementData)
        await sendEmail(engagement.clientEmail, clientTemplate)
        console.log(`[OUTREACH] Sent completion email to ${engagement.clientEmail}`)

        // Notify accountant
        const accountantEmail = process.env.ACCOUNTANT_EMAIL ?? engagement.clientEmail
        const accountantTemplate = emailTemplates.accountant_notification(engagementData)
        await sendEmail(accountantEmail, accountantTemplate)
        console.log(`[OUTREACH] Notified accountant at ${accountantEmail}`)
        break
      }
    }

    // Log agent activity
    const existingLog = (engagement.agentLog as object[] | null) ?? []
    const newEntry = {
      timestamp: new Date().toISOString(),
      agent: 'outreach',
      trigger,
      outcome: 'success'
    }

    await prisma.engagement.update({
      where: { id: engagementId },
      data: {
        agentLog: [...existingLog, newEntry] as object[],
        lastActivityAt: new Date()
      }
    })

    console.log(`[OUTREACH] Completed ${trigger} for ${engagementId}`)
  } catch (error) {
    console.error(`[OUTREACH] Error handling ${trigger} for ${engagementId}:`, error)
    throw error
  }
}
