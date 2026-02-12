import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { getStorageClient, detectProvider } from '../lib/storage/index.js'
import { dispatch } from '../lib/agents/dispatcher.js'
import { runReconciliationAgent } from '../lib/agents/reconciliation.js'
import { generatePrepBrief } from '../lib/openai.js'
import { runInBackground } from '../workers/background.js'
import { pollEngagement } from '../lib/poll-engagement.js'
import type { ChecklistItem, Document, Reconciliation } from '../types.js'

const app = new Hono()

const CreateEngagementSchema = z.object({
  clientName: z.string().min(1),
  clientEmail: z.string().email(),
  storageFolderUrl: z.string().url(),
})

// GET /api/engagements - List all engagements
app.get('/', async (c) => {
  const engagements = await prisma.engagement.findMany({
    orderBy: { createdAt: 'desc' },
    include: { documents: true }
  })
  return c.json(engagements)
})

// POST /api/engagements - Create new engagement
app.post('/', zValidator('json', CreateEngagementSchema), async (c) => {
  try {
    const body = c.req.valid('json')

    // Get Typeform Form ID from environment
    const typeformFormId = process.env.TYPEFORM_FORM_ID
    if (!typeformFormId) {
      return c.json({ error: 'TYPEFORM_FORM_ID environment variable not set' }, 500)
    }

    const folderUrl = body.storageFolderUrl

    // Detect provider from URL
    const provider = detectProvider(folderUrl)
    if (!provider) {
      return c.json(
        { error: 'Unsupported storage URL. Please provide a Dropbox folder URL.' },
        400
      )
    }

    // Resolve URL to folder IDs
    let storageFolderId: string | null = null
    let storageDriveId: string | null = null

    try {
      const client = getStorageClient(provider)
      const resolved = await client.resolveUrl(folderUrl)
      if (resolved) {
        storageFolderId = resolved.folderId
        storageDriveId = resolved.driveId || null
      }
    } catch (error) {
      console.warn('Could not resolve storage URL:', error)
    }

    const engagement = await prisma.engagement.create({
      data: {
        clientName: body.clientName,
        clientEmail: body.clientEmail,
        taxYear: new Date().getFullYear(),
        typeformFormId,
        storageProvider: provider,
        storageFolderUrl: folderUrl,
        storageFolderId,
        storageDriveId,
      },
    })

    // Trigger Outreach Agent to send welcome email (background)
    runInBackground(() => dispatch({
      type: 'engagement_created',
      engagementId: engagement.id
    }))

    return c.json(engagement, 201)
  } catch (error) {
    console.error('Error creating engagement:', error)
    return c.json(
      { error: error instanceof Error ? error.message : 'Failed to create engagement' },
      500
    )
  }
})

// GET /api/engagements/:id - Get single engagement
app.get('/:id', async (c) => {
  const id = c.req.param('id')
  const engagement = await prisma.engagement.findUnique({
    where: { id },
    include: { documents: true }
  })

  if (!engagement) {
    return c.json({ error: 'Engagement not found' }, 404)
  }

  return c.json(engagement)
})

const UpdateEngagementSchema = z.object({
  storageFolderId: z.string().optional(),
  storageDriveId: z.string().optional(),
  storageFolderUrl: z.string().url().nullable().optional(),
  storageProvider: z.enum(['dropbox', 'google-drive']).optional(),
  storagePageToken: z.string().nullable().optional(),
  status: z.enum(['PENDING', 'INTAKE_DONE', 'COLLECTING', 'READY']).optional(),
})

// PATCH /api/engagements/:id - Update engagement
app.patch('/:id', zValidator('json', UpdateEngagementSchema), async (c) => {
  const id = c.req.param('id')
  const body = c.req.valid('json')

  const engagement = await prisma.engagement.findUnique({ where: { id } })

  if (!engagement) {
    return c.json({ error: 'Engagement not found' }, 404)
  }

  const updateData: Record<string, unknown> = {}

  if (body.storageFolderId !== undefined) {
    updateData.storageFolderId = body.storageFolderId
  }

  if (body.storageDriveId !== undefined) {
    updateData.storageDriveId = body.storageDriveId
  }

  if (body.storageFolderUrl !== undefined) {
    updateData.storageFolderUrl = body.storageFolderUrl
    updateData.storagePageToken = null
  }

  if (body.storageProvider !== undefined) {
    updateData.storageProvider = body.storageProvider
  }

  if (body.storagePageToken !== undefined) {
    updateData.storagePageToken = body.storagePageToken
  }

  if (body.status !== undefined) {
    updateData.status = body.status
  }

  const updated = await prisma.engagement.update({
    where: { id },
    data: updateData,
  })

  return c.json(updated)
})

// POST /api/engagements/:id/brief - Generate prep brief
app.post('/:id/brief', async (c) => {
  const id = c.req.param('id')

  const engagement = await prisma.engagement.findUnique({
    where: { id },
    include: { documents: true }
  })

  if (!engagement) {
    return c.json({ error: 'Engagement not found' }, 404)
  }

  if (engagement.status !== 'READY') {
    return c.json(
      { error: 'Engagement must be in READY status to generate brief' },
      400
    )
  }

  const checklist = (engagement.checklist as ChecklistItem[]) || []
  const documents = engagement.documents
  const reconciliation = (engagement.reconciliation as Reconciliation) || {
    completionPercentage: 0,
    issues: [],
  }

  const brief = await generatePrepBrief({
    clientName: engagement.clientName,
    taxYear: engagement.taxYear,
    checklist,
    documents: documents as unknown as Document[],
    reconciliation: {
      completionPercentage: reconciliation.completionPercentage,
      issues: reconciliation.issues,
    },
  })

  await prisma.engagement.update({
    where: { id },
    data: { prepBrief: brief },
  })

  return c.json({ success: true, brief })
})

// POST /api/engagements/:id/retry-documents - Retry processing of PENDING documents
app.post('/:id/retry-documents', async (c) => {
  const id = c.req.param('id')

  const engagement = await prisma.engagement.findUnique({ where: { id } })

  if (!engagement) {
    return c.json({ error: 'Engagement not found' }, 404)
  }

  const pendingDocs = await prisma.document.findMany({
    where: { engagementId: id, documentType: 'PENDING' }
  })

  if (pendingDocs.length === 0) {
    return c.json({ message: 'No PENDING documents to retry', retried: 0 })
  }

  for (const doc of pendingDocs) {
    runInBackground(() => dispatch({
      type: 'document_uploaded',
      engagementId: id,
      documentId: doc.id,
      storageItemId: doc.storageItemId,
      fileName: doc.fileName
    }))
  }

  console.log(`[RETRY] Dispatched ${pendingDocs.length} PENDING documents for ${id}`)

  return c.json({
    message: `Retrying ${pendingDocs.length} PENDING documents`,
    retried: pendingDocs.length,
    documentIds: pendingDocs.map(d => d.id)
  })
})

// POST /api/engagements/:id/process - Poll storage and dispatch pending docs
app.post('/:id/process', async (c) => {
  const id = c.req.param('id')

  const engagement = await prisma.engagement.findUnique({ where: { id } })

  if (!engagement) {
    return c.json({ error: 'Engagement not found' }, 404)
  }

  if (!['INTAKE_DONE', 'COLLECTING'].includes(engagement.status)) {
    return c.json(
      { error: 'Engagement must be in INTAKE_DONE or COLLECTING status' },
      400
    )
  }

  // Poll storage for new files
  await pollEngagement(engagement)

  // Find remaining PENDING docs that aren't already processing
  const pendingDocs = await prisma.document.findMany({
    where: {
      engagementId: id,
      documentType: 'PENDING',
      processingStatus: { notIn: ['downloading', 'extracting', 'classifying'] }
    }
  })

  for (const doc of pendingDocs) {
    runInBackground(() => dispatch({
      type: 'document_uploaded',
      engagementId: id,
      documentId: doc.id,
      storageItemId: doc.storageItemId,
      fileName: doc.fileName
    }))
  }

  const totalDocs = await prisma.document.count({ where: { engagementId: id } })

  return c.json({
    success: true,
    totalDocuments: totalDocs,
    pendingDocuments: pendingDocs.length,
  })
})

// POST /api/engagements/:id/reconcile - Manually trigger reconciliation
app.post('/:id/reconcile', async (c) => {
  const { id } = c.req.param()

  const engagement = await prisma.engagement.findUnique({
    where: { id }
  })

  if (!engagement) {
    return c.json({ error: 'Engagement not found' }, 404)
  }

  try {
    const result = await runReconciliationAgent({
      trigger: 'manual_reconciliation',
      engagementId: id
    })

    return c.json({
      message: 'Reconciliation complete',
      isReady: result.isReady,
      completionPercentage: result.completionPercentage
    })
  } catch (error) {
    console.error(`[RECONCILE] Error for ${id}:`, error)
    return c.json(
      { error: error instanceof Error ? error.message : 'Reconciliation failed' },
      500
    )
  }
})

// DELETE /api/engagements/:id - Delete an engagement
app.delete('/:id', async (c) => {
  const id = c.req.param('id')

  const engagement = await prisma.engagement.findUnique({
    where: { id }
  })

  if (!engagement) {
    return c.json({ error: 'Engagement not found' }, 404)
  }

  await prisma.engagement.delete({
    where: { id }
  })

  return c.json({ message: 'Engagement deleted successfully' })
})

// DELETE /api/engagements - Delete ALL engagements (for demo reset)
app.delete('/', async (c) => {
  const result = await prisma.engagement.deleteMany({})

  console.log(`[DEMO RESET] Deleted ${result.count} engagements`)

  return c.json({
    message: 'All engagements deleted successfully',
    count: result.count
  })
})

export default app
