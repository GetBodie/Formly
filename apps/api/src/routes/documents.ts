import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { sendEmail } from '../lib/email.js'
import { parseIssue, getSuggestedAction } from '../lib/issues.js'
import { generateFollowUpEmail, generateFriendlyIssues } from '../lib/openai.js'
import { runReconciliationAgent } from '../lib/agents/reconciliation.js'
import { runAssessmentFast } from '../lib/agents/assessment-fast.js'
import { DOCUMENT_TYPES, type Document } from '../types.js'

const app = new Hono()

// POST /api/engagements/:engagementId/documents/:docId/approve
app.post(
  '/:engagementId/documents/:docId/approve',
  async (c) => {
    const { engagementId, docId } = c.req.param()

    const engagement = await prisma.engagement.findUnique({
      where: { id: engagementId }
    })
    if (!engagement) {
      return c.json({ error: 'Engagement not found' }, 404)
    }

    const documents = (engagement.documents as Document[]) || []
    const docIndex = documents.findIndex(d => d.id === docId)
    if (docIndex === -1) {
      return c.json({ error: 'Document not found' }, 404)
    }

    documents[docIndex].approved = true
    documents[docIndex].approvedAt = new Date().toISOString()

    await prisma.engagement.update({
      where: { id: engagementId },
      data: { documents }
    })

    // Trigger reconciliation to match document to checklist and update completion
    runReconciliationAgent({
      trigger: 'document_assessed',
      engagementId,
      documentId: docId,
      documentType: documents[docIndex].documentType
    }).catch(err => console.error('[APPROVE] Reconciliation failed:', err))

    return c.json({ success: true, document: documents[docIndex] })
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

    const engagement = await prisma.engagement.findUnique({
      where: { id: engagementId }
    })
    if (!engagement) {
      return c.json({ error: 'Engagement not found' }, 404)
    }

    const documents = (engagement.documents as Document[]) || []
    const docIndex = documents.findIndex(d => d.id === docId)
    if (docIndex === -1) {
      return c.json({ error: 'Document not found' }, 404)
    }

    const doc = documents[docIndex]
    // #31: Track original type if this is first reclassification, otherwise keep existing override
    if (!doc.override) {
      doc.override = {
        originalType: doc.documentType,
        reason: `Reclassified from ${doc.documentType} to ${newType}`,
      }
    } else {
      doc.override.reason = `Reclassified from ${doc.override.originalType} to ${newType}`
    }
    doc.documentType = newType
    // #31: Don't auto-approve on reclassify - user should explicitly approve
    // doc.approved = true
    // doc.approvedAt = new Date().toISOString()

    await prisma.engagement.update({
      where: { id: engagementId },
      data: { documents }
    })

    // Trigger reconciliation to match document to checklist and update completion
    runReconciliationAgent({
      trigger: 'document_assessed',
      engagementId,
      documentId: docId,
      documentType: newType
    }).catch(err => console.error('[RECLASSIFY] Reconciliation failed:', err))

    return c.json({ success: true, document: doc })
  }
)

// GET /api/engagements/:engagementId/documents/:docId/email-preview
// Generate email content for preview/editing
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

    const documents = (engagement.documents as Document[]) || []
    const doc = documents.find(d => d.id === docId)
    if (!doc) {
      return c.json({ error: 'Document not found' }, 404)
    }

    if (doc.issues.length === 0) {
      return c.json({ error: 'Document has no issues to report' }, 400)
    }

    // Parse issues for email generation
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

    const documents = (engagement.documents as Document[]) || []
    const doc = documents.find(d => d.id === docId)
    if (!doc) {
      return c.json({ error: 'Document not found' }, 404)
    }

    // Use provided email or fall back to client email
    const recipientEmail = body.email || engagement.clientEmail

    // If subject and body are provided, use them directly
    // Otherwise, generate them
    let emailSubject = body.subject
    let emailBody = body.body

    if (!emailSubject || !emailBody) {
      if (doc.issues.length === 0) {
        return c.json({ error: 'Document has no issues to report' }, 400)
      }

      // Parse issues for email generation
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

      // Build HTML email
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

// GET /api/engagements/:engagementId/documents/:docId/friendly-issues
// Return cached friendly issues or generate them on-demand for legacy documents
app.get(
  '/:engagementId/documents/:docId/friendly-issues',
  async (c) => {
    const { engagementId, docId } = c.req.param()

    const engagement = await prisma.engagement.findUnique({
      where: { id: engagementId }
    })
    if (!engagement) {
      return c.json({ error: 'Engagement not found' }, 404)
    }

    const documents = (engagement.documents as Document[]) || []
    const doc = documents.find(d => d.id === docId)
    if (!doc) {
      return c.json({ error: 'Document not found' }, 404)
    }

    if (doc.issues.length === 0) {
      return c.json({ issues: [] })
    }

    // Return cached issue details if available
    if (doc.issueDetails && doc.issueDetails.length > 0) {
      return c.json({ issues: doc.issueDetails })
    }

    // Fallback: Generate friendly issues on-demand for legacy documents
    const parsedIssues = doc.issues.map(issueStr => {
      const parsed = parseIssue(issueStr)
      return {
        severity: parsed.severity,
        type: parsed.type,
        description: parsed.description
      }
    })

    const friendlyIssues = await generateFriendlyIssues(
      doc.fileName,
      doc.documentType,
      engagement.taxYear,
      parsedIssues
    )

    return c.json({ issues: friendlyIssues })
  }
)

// POST /api/engagements/:engagementId/documents/:docId/archive
// Archive a document (for replacement flow)
const ArchiveSchema = z.object({
  reason: z.string().optional().default('Replaced by newer document')
})

app.post(
  '/:engagementId/documents/:docId/archive',
  zValidator('json', ArchiveSchema),
  async (c) => {
    const { engagementId, docId } = c.req.param()
    const { reason } = c.req.valid('json')

    const engagement = await prisma.engagement.findUnique({
      where: { id: engagementId }
    })
    if (!engagement) {
      return c.json({ error: 'Engagement not found' }, 404)
    }

    const documents = (engagement.documents as Document[]) || []
    const docIndex = documents.findIndex(d => d.id === docId)
    if (docIndex === -1) {
      return c.json({ error: 'Document not found' }, 404)
    }

    documents[docIndex].archived = true
    documents[docIndex].archivedAt = new Date().toISOString()
    documents[docIndex].archivedReason = reason

    await prisma.engagement.update({
      where: { id: engagementId },
      data: { documents }
    })

    // Trigger reconciliation to update completion without this document
    runReconciliationAgent({
      trigger: 'document_assessed',
      engagementId,
      documentId: docId,
      documentType: documents[docIndex].documentType
    }).catch(err => console.error('[ARCHIVE] Reconciliation failed:', err))

    return c.json({ success: true, document: documents[docIndex] })
  }
)

// POST /api/engagements/:engagementId/documents/:docId/unarchive
// Restore an archived document
app.post(
  '/:engagementId/documents/:docId/unarchive',
  async (c) => {
    const { engagementId, docId } = c.req.param()

    const engagement = await prisma.engagement.findUnique({
      where: { id: engagementId }
    })
    if (!engagement) {
      return c.json({ error: 'Engagement not found' }, 404)
    }

    const documents = (engagement.documents as Document[]) || []
    const docIndex = documents.findIndex(d => d.id === docId)
    if (docIndex === -1) {
      return c.json({ error: 'Document not found' }, 404)
    }

    documents[docIndex].archived = false
    documents[docIndex].archivedAt = null
    documents[docIndex].archivedReason = null

    await prisma.engagement.update({
      where: { id: engagementId },
      data: { documents }
    })

    // Trigger reconciliation to include this document again
    runReconciliationAgent({
      trigger: 'document_assessed',
      engagementId,
      documentId: docId,
      documentType: documents[docIndex].documentType
    }).catch(err => console.error('[UNARCHIVE] Reconciliation failed:', err))

    return c.json({ success: true, document: documents[docIndex] })
  }
)

const MAX_RETRY_COUNT = 3

// GET /api/engagements/:engagementId/documents/processing-status
// Get processing status of all documents in an engagement
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

    const documents = (engagement.documents as Document[]) || []
    const now = Date.now()
    const STUCK_THRESHOLD_MS = 5 * 60 * 1000 // 5 minutes

    const statuses = documents.map(doc => {
      const startedAt = doc.processingStartedAt ? new Date(doc.processingStartedAt).getTime() : null
      const processingDuration = startedAt ? now - startedAt : null
      const isStuck = processingDuration !== null && processingDuration > STUCK_THRESHOLD_MS &&
        ['downloading', 'extracting', 'classifying', 'pending'].includes(doc.processingStatus || 'pending')
      
      return {
        id: doc.id,
        fileName: doc.fileName,
        documentType: doc.documentType,
        processingStatus: doc.processingStatus || 'pending',
        processingStartedAt: doc.processingStartedAt,
        processingDurationMs: processingDuration,
        retryCount: doc.retryCount || 0,
        maxRetries: MAX_RETRY_COUNT,
        isStuck,
        canRetry: (doc.retryCount || 0) < MAX_RETRY_COUNT,
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
// Retry processing a document that failed
// Query params:
//   ?force=true - Reset retry count and force retry even if at max attempts
app.post(
  '/:engagementId/documents/:docId/retry',
  async (c) => {
    const { engagementId, docId } = c.req.param()
    const forceRetry = c.req.query('force') === 'true'

    const engagement = await prisma.engagement.findUnique({
      where: { id: engagementId }
    })
    if (!engagement) {
      return c.json({ error: 'Engagement not found' }, 404)
    }

    const documents = (engagement.documents as Document[]) || []
    const docIndex = documents.findIndex(d => d.id === docId)
    if (docIndex === -1) {
      return c.json({ error: 'Document not found' }, 404)
    }

    const doc = documents[docIndex]
    const retryCount = doc.retryCount || 0

    // Check if document has exceeded max retries
    if (retryCount >= MAX_RETRY_COUNT && !forceRetry) {
      return c.json({ 
        error: `Document has exceeded max retry attempts (${MAX_RETRY_COUNT}). Use ?force=true to reset and retry.`,
        retryCount,
        maxRetries: MAX_RETRY_COUNT
      }, 400)
    }

    // Reset document to pending state for reprocessing
    documents[docIndex] = {
      ...doc,
      processingStatus: 'pending',
      processingStartedAt: null,
      documentType: 'PENDING',
      confidence: 0,
      issues: [],
      issueDetails: null,
      classifiedAt: null,
      retryCount: forceRetry ? 0 : retryCount // Reset if forced, otherwise keep count
    }

    await prisma.engagement.update({
      where: { id: engagementId },
      data: { documents }
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
      document: documents[docIndex],
      forced: forceRetry,
      previousRetryCount: retryCount
    })
  }
)

export default app
