import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { sendEmail } from '../lib/email.js'
import { parseIssue, getSuggestedAction } from '../lib/issues.js'
import { generateFollowUpEmail, generateFriendlyIssues } from '../lib/openai.js'
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
    doc.override = {
      originalType: doc.documentType,
      reason: `Reclassified from ${doc.documentType} to ${newType}`,
    }
    doc.documentType = newType
    doc.approved = true
    doc.approvedAt = new Date().toISOString()

    await prisma.engagement.update({
      where: { id: engagementId },
      data: { documents }
    })

    return c.json({ success: true, document: doc })
  }
)

// POST /api/engagements/:engagementId/documents/:docId/send-followup
app.post(
  '/:engagementId/documents/:docId/send-followup',
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

    // Parse issues for Haiku email generation
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
      // Generate personalized email using Haiku
      const emailContent = await generateFollowUpEmail({
        clientName: engagement.clientName,
        taxYear: engagement.taxYear,
        fileName: doc.fileName,
        issues: parsedIssues
      })

      const uploadUrl = engagement.storageFolderUrl || engagement.sharepointFolderUrl!

      // Build HTML email from Haiku-generated content
      const emailHtml = `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <p>${emailContent.body.replace(/\n/g, '<br>')}</p>
          <p style="margin: 24px 0;">
            <a href="${uploadUrl}"
               style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
              Upload Corrected Document
            </a>
          </p>
        </div>
      `

      await sendEmail(
        engagement.clientEmail,
        { subject: emailContent.subject, html: emailHtml }
      )
      return c.json({ success: true, message: 'Follow-up email sent' })
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
// Generate human-friendly issue messages for the admin UI
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

    // Parse issues to structured format
    const parsedIssues = doc.issues.map(issueStr => {
      const parsed = parseIssue(issueStr)
      return {
        severity: parsed.severity,
        type: parsed.type,
        description: parsed.description
      }
    })

    // Generate friendly messages using LLM
    const friendlyIssues = await generateFriendlyIssues(
      doc.fileName,
      doc.documentType,
      engagement.taxYear,
      parsedIssues
    )

    return c.json({ issues: friendlyIssues })
  }
)

export default app
