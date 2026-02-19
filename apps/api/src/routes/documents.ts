import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { sendEmail } from '../lib/email.js'
import { parseIssue, getSuggestedAction } from '../lib/issues.js'
import { generateFollowUpEmail, generateChecks } from '../lib/openai.js'
import { runReconciliationAgent } from '../lib/agents/reconciliation.js'
import { runAssessmentFast } from '../lib/agents/assessment-fast.js'
import { DOCUMENT_TYPES } from '../types.js'

const app = new Hono()

// POST /api/engagements/:engagementId/documents/:docId/approve
app.post(
  '/:engagementId/documents/:docId/approve',
  async (c) => {
    const { engagementId, docId } = c.req.param()

    const doc = await prisma.document.findFirst({
      where: { id: docId, engagementId }
    })
    if (!doc) {
      const engagement = await prisma.engagement.findUnique({ where: { id: engagementId } })
      if (!engagement) return c.json({ error: 'Engagement not found' }, 404)
      return c.json({ error: 'Document not found' }, 404)
    }

    const updated = await prisma.document.update({
      where: { id: docId },
      data: { approvedAt: new Date() }
    })

    // Trigger reconciliation
    runReconciliationAgent({
      trigger: 'document_assessed',
      engagementId,
      documentId: docId,
      documentType: doc.documentType
    }).catch(err => console.error('[APPROVE] Reconciliation failed:', err))

    return c.json({ success: true, document: updated })
  }
)

// POST /api/engagements/:engagementId/documents/:docId/reclassify
const ReclassifySchema = z.object({
  newType: z.string().refine(
    (val) => DOCUMENT_TYPES.includes(val as typeof DOCUMENT_TYPES[number]),
    { message: 'Invalid document type' }
  )
})

app.post(
  '/:engagementId/documents/:docId/reclassify',
  zValidator('json', ReclassifySchema),
  async (c) => {
    const { engagementId, docId } = c.req.param()
    const { newType } = c.req.valid('json')

    const doc = await prisma.document.findFirst({
      where: { id: docId, engagementId }
    })
    if (!doc) {
      const engagement = await prisma.engagement.findUnique({ where: { id: engagementId } })
      if (!engagement) return c.json({ error: 'Engagement not found' }, 404)
      return c.json({ error: 'Document not found' }, 404)
    }

    const existingOverride = doc.override as { originalType: string; reason: string } | null
    const override = existingOverride
      ? { originalType: existingOverride.originalType, reason: `Reclassified from ${existingOverride.originalType} to ${newType}` }
      : { originalType: doc.documentType, reason: `Reclassified from ${doc.documentType} to ${newType}` }

    const updated = await prisma.document.update({
      where: { id: docId },
      data: {
        documentType: newType,
        approvedAt: null,
        override
      }
    })

    // Trigger reconciliation
    runReconciliationAgent({
      trigger: 'document_assessed',
      engagementId,
      documentId: docId,
      documentType: newType
    }).catch(err => console.error('[RECLASSIFY] Reconciliation failed:', err))

    return c.json({ success: true, document: updated })
  }
)

// GET /api/engagements/:engagementId/documents/:docId/email-preview
app.get(
  '/:engagementId/documents/:docId/email-preview',
  async (c) => {
    const { engagementId, docId } = c.req.param()

    const engagement = await prisma.engagement.findUnique({
      where: { id: engagementId }
    })
    if (!engagement) {
      return c.json({ error: 'Engagement not found' }, 404)
    }

    const doc = await prisma.document.findFirst({
      where: { id: docId, engagementId }
    })
    if (!doc) {
      return c.json({ error: 'Document not found' }, 404)
    }

    if (doc.issues.length === 0) {
      return c.json({ error: 'Document has no issues to report' }, 400)
    }

    const parsedIssues = doc.issues.map(issueStr => {
      const parsed = parseIssue(issueStr)
      return {
        severity: parsed.severity,
        type: parsed.type,
        description: parsed.description,
        suggestedAction: getSuggestedAction(parsed)
      }
    })

    try {
      const emailContent = await generateFollowUpEmail({
        clientName: engagement.clientName,
        taxYear: engagement.taxYear,
        fileName: doc.fileName,
        issues: parsedIssues
      })

      return c.json({
        subject: emailContent.subject,
        body: emailContent.body,
        recipientEmail: engagement.clientEmail,
        uploadUrl: engagement.storageFolderUrl
      })
    } catch (error) {
      console.error('Failed to generate email preview:', error)
      return c.json(
        { error: error instanceof Error ? error.message : 'Failed to generate email' },
        500
      )
    }
  }
)

// POST /api/engagements/:engagementId/documents/:docId/send-followup
const SendFollowUpSchema = z.object({
  email: z.string().email().optional(),
  subject: z.string().min(1).optional(),
  body: z.string().min(1).optional()
})

app.post(
  '/:engagementId/documents/:docId/send-followup',
  zValidator('json', SendFollowUpSchema),
  async (c) => {
    const { engagementId, docId } = c.req.param()
    const body = c.req.valid('json')

    const engagement = await prisma.engagement.findUnique({
      where: { id: engagementId }
    })
    if (!engagement) {
      return c.json({ error: 'Engagement not found' }, 404)
    }

    const doc = await prisma.document.findFirst({
      where: { id: docId, engagementId }
    })
    if (!doc) {
      return c.json({ error: 'Document not found' }, 404)
    }

    const recipientEmail = body.email || engagement.clientEmail

    let emailSubject = body.subject
    let emailBody = body.body

    if (!emailSubject || !emailBody) {
      if (doc.issues.length === 0) {
        return c.json({ error: 'Document has no issues to report' }, 400)
      }

      const parsedIssues = doc.issues.map(issueStr => {
        const parsed = parseIssue(issueStr)
        return {
          severity: parsed.severity,
          type: parsed.type,
          description: parsed.description,
          suggestedAction: getSuggestedAction(parsed)
        }
      })

      const emailContent = await generateFollowUpEmail({
        clientName: engagement.clientName,
        taxYear: engagement.taxYear,
        fileName: doc.fileName,
        issues: parsedIssues
      })

      emailSubject = emailSubject || emailContent.subject
      emailBody = emailBody || emailContent.body
    }

    try {
      const uploadUrl = engagement.storageFolderUrl

      const emailHtml = `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <p>${emailBody.replace(/\n/g, '<br>')}</p>
          <p style="margin: 24px 0;">
            <a href="${uploadUrl}"
               style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
              Upload Corrected Document
            </a>
          </p>
        </div>
      `

      await sendEmail(
        recipientEmail,
        { subject: emailSubject, html: emailHtml }
      )
      return c.json({ success: true, message: `Follow-up email sent to ${recipientEmail}` })
    } catch (error) {
      console.error('Failed to send follow-up email:', error)
      return c.json(
        { error: error instanceof Error ? error.message : 'Failed to send email' },
        500
      )
    }
  }
)

// GET /api/engagements/:engagementId/documents/:docId/checks
app.get(
  '/:engagementId/documents/:docId/checks',
  async (c) => {
    const { engagementId, docId } = c.req.param()

    const engagement = await prisma.engagement.findUnique({
      where: { id: engagementId }
    })
    if (!engagement) {
      return c.json({ error: 'Engagement not found' }, 404)
    }

    const doc = await prisma.document.findFirst({
      where: { id: docId, engagementId }
    })
    if (!doc) {
      return c.json({ error: 'Document not found' }, 404)
    }

    if (doc.issues.length === 0) {
      return c.json({ issues: [] })
    }

    // Return cached checks if available
    const checks = doc.checks as Array<{ original: string; friendlyMessage: string; suggestedAction: string; severity: string }> | null
    if (checks && checks.length > 0) {
      return c.json({ issues: checks })
    }

    // Fallback: Generate checks on-demand for legacy documents
    const parsedIssues = doc.issues.map(issueStr => {
      const parsed = parseIssue(issueStr)
      return {
        severity: parsed.severity,
        type: parsed.type,
        description: parsed.description
      }
    })

    const generatedChecks = await generateChecks(
      doc.fileName,
      doc.documentType,
      engagement.taxYear,
      parsedIssues
    )

    return c.json({ issues: generatedChecks })
  }
)

// POST /api/engagements/:engagementId/documents/:docId/archive
const ArchiveSchema = z.object({
  reason: z.string().optional().default('Replaced by newer document')
})

app.post(
  '/:engagementId/documents/:docId/archive',
  zValidator('json', ArchiveSchema),
  async (c) => {
    const { engagementId, docId } = c.req.param()
    const { reason } = c.req.valid('json')

    const doc = await prisma.document.findFirst({
      where: { id: docId, engagementId }
    })
    if (!doc) {
      const engagement = await prisma.engagement.findUnique({ where: { id: engagementId } })
      if (!engagement) return c.json({ error: 'Engagement not found' }, 404)
      return c.json({ error: 'Document not found' }, 404)
    }

    const updated = await prisma.document.update({
      where: { id: docId },
      data: {
        archivedAt: new Date(),
        archivedReason: reason
      }
    })

    // Trigger reconciliation to update completion without this document
    runReconciliationAgent({
      trigger: 'document_assessed',
      engagementId,
      documentId: docId,
      documentType: doc.documentType
    }).catch(err => console.error('[ARCHIVE] Reconciliation failed:', err))

    return c.json({ success: true, document: updated })
  }
)

// POST /api/engagements/:engagementId/documents/:docId/unarchive
app.post(
  '/:engagementId/documents/:docId/unarchive',
  async (c) => {
    const { engagementId, docId } = c.req.param()

    const doc = await prisma.document.findFirst({
      where: { id: docId, engagementId }
    })
    if (!doc) {
      const engagement = await prisma.engagement.findUnique({ where: { id: engagementId } })
      if (!engagement) return c.json({ error: 'Engagement not found' }, 404)
      return c.json({ error: 'Document not found' }, 404)
    }

    const updated = await prisma.document.update({
      where: { id: docId },
      data: {
        archivedAt: null,
        archivedReason: null
      }
    })

    // Trigger reconciliation to include this document again
    runReconciliationAgent({
      trigger: 'document_assessed',
      engagementId,
      documentId: docId,
      documentType: doc.documentType
    }).catch(err => console.error('[UNARCHIVE] Reconciliation failed:', err))

    return c.json({ success: true, document: updated })
  }
)

const MAX_RETRY_COUNT = 3

// GET /api/engagements/:engagementId/documents/processing-status
app.get(
  '/:engagementId/documents/processing-status',
  async (c) => {
    const { engagementId } = c.req.param()

    const engagement = await prisma.engagement.findUnique({
      where: { id: engagementId }
    })
    if (!engagement) {
      return c.json({ error: 'Engagement not found' }, 404)
    }

    const documents = await prisma.document.findMany({
      where: { engagementId }
    })

    const now = Date.now()
    const STUCK_THRESHOLD_MS = 5 * 60 * 1000

    const statuses = documents.map(doc => {
      const startedAt = doc.processingStartedAt ? doc.processingStartedAt.getTime() : null
      const processingDuration = startedAt ? now - startedAt : null
      const isStuck = processingDuration !== null && processingDuration > STUCK_THRESHOLD_MS &&
        ['downloading', 'extracting', 'classifying', 'pending'].includes(doc.processingStatus)

      return {
        id: doc.id,
        fileName: doc.fileName,
        documentType: doc.documentType,
        processingStatus: doc.processingStatus,
        processingStartedAt: doc.processingStartedAt?.toISOString() ?? null,
        processingDurationMs: processingDuration,
        retryCount: doc.retryCount,
        maxRetries: MAX_RETRY_COUNT,
        isStuck,
        canRetry: doc.retryCount < MAX_RETRY_COUNT,
        issues: doc.issues
      }
    })

    const summary = {
      total: documents.length,
      pending: statuses.filter(s => s.processingStatus === 'pending').length,
      processing: statuses.filter(s => ['downloading', 'extracting', 'classifying'].includes(s.processingStatus)).length,
      classified: statuses.filter(s => s.processingStatus === 'classified').length,
      error: statuses.filter(s => s.processingStatus === 'error').length,
      stuck: statuses.filter(s => s.isStuck).length
    }

    return c.json({ summary, documents: statuses })
  }
)

// POST /api/engagements/:engagementId/documents/:docId/retry
app.post(
  '/:engagementId/documents/:docId/retry',
  async (c) => {
    const { engagementId, docId } = c.req.param()
    const forceRetry = c.req.query('force') === 'true'

    const doc = await prisma.document.findFirst({
      where: { id: docId, engagementId }
    })
    if (!doc) {
      const engagement = await prisma.engagement.findUnique({ where: { id: engagementId } })
      if (!engagement) return c.json({ error: 'Engagement not found' }, 404)
      return c.json({ error: 'Document not found' }, 404)
    }

    if (doc.retryCount >= MAX_RETRY_COUNT && !forceRetry) {
      return c.json({
        error: `Document has exceeded max retry attempts (${MAX_RETRY_COUNT}). Use ?force=true to reset and retry.`,
        retryCount: doc.retryCount,
        maxRetries: MAX_RETRY_COUNT
      }, 400)
    }

    const updated = await prisma.document.update({
      where: { id: docId },
      data: {
        processingStatus: 'pending',
        processingStartedAt: null,
        documentType: 'PENDING',
        confidence: 0,
        issues: [],
        checks: Prisma.JsonNull,
        classifiedAt: null,
        retryCount: forceRetry ? 0 : doc.retryCount
      }
    })

    // Trigger fast assessment to reprocess
    runAssessmentFast({
      engagementId,
      documentId: docId,
      storageItemId: doc.storageItemId,
      fileName: doc.fileName
    }).catch(err => console.error('[RETRY] Assessment failed:', err))

    return c.json({
      success: true,
      document: updated,
      forced: forceRetry,
      previousRetryCount: doc.retryCount
    })
  }
)

export default app
