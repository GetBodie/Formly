import { Hono } from 'hono'
import { prisma } from '../lib/prisma.js'
import { dispatch } from '../lib/agents/dispatcher.js'
import { runInBackground, runAllInBackground } from '../workers/background.js'
import { pollEngagement } from '../lib/poll-engagement.js'

const app = new Hono()

// Middleware to verify CRON_SECRET
app.use('*', async (c, next) => {
  const auth = c.req.header('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  await next()
})

// GET /api/cron/poll-storage - Poll storage for new documents
app.get('/poll-storage', async (c) => {
  const engagements = await prisma.engagement.findMany({
    where: { status: { in: ['INTAKE_DONE', 'COLLECTING'] } },
  })

  // Process all in background
  runAllInBackground(engagements.map(engagement => () => pollEngagement(engagement)))

  // Also retry stuck documents
  const stuckResult = await retryStuckDocuments()

  return c.json({
    queued: engagements.length,
    retriedStuck: stuckResult.retried,
    permanentlyFailed: stuckResult.permanentlyFailed
  })
})

// GET /api/cron/check-reminders - Check for stale engagements and send reminders
app.get('/check-reminders', async (c) => {
  const threeDaysAgo = new Date()
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3)

  const staleEngagements = await prisma.engagement.findMany({
    where: {
      status: { in: ['INTAKE_DONE', 'COLLECTING'] },
      lastActivityAt: { lt: threeDaysAgo },
      reminderCount: { lt: 5 }
    }
  })

  for (const engagement of staleEngagements) {
    runInBackground(() => dispatch({
      type: 'stale_engagement',
      engagementId: engagement.id
    }))
  }

  console.log(`[REMINDERS] Dispatched reminders for ${staleEngagements.length} stale engagements`)

  return c.json({
    checked: staleEngagements.length,
    engagementIds: staleEngagements.map(e => e.id)
  })
})

const MAX_RETRY_COUNT = 3
const STUCK_THRESHOLD_MS = 5 * 60 * 1000 // 5 minutes

// GET /api/cron/stuck-documents - List all stuck documents across engagements
app.get('/stuck-documents', async (c) => {
  const fiveMinutesAgo = new Date(Date.now() - STUCK_THRESHOLD_MS)

  const stuckDocs = await prisma.document.findMany({
    where: {
      engagement: { status: { in: ['INTAKE_DONE', 'COLLECTING'] } },
      OR: [
        {
          processingStatus: { in: ['downloading', 'extracting', 'classifying', 'pending'] },
          processingStartedAt: { lt: fiveMinutesAgo }
        },
        { processingStatus: 'error' },
        { documentType: 'PROCESSING_ERROR' }
      ]
    },
    include: { engagement: { select: { id: true, clientName: true } } }
  })

  const result = stuckDocs.map(doc => ({
    engagementId: doc.engagement.id,
    clientName: doc.engagement.clientName,
    documentId: doc.id,
    fileName: doc.fileName,
    status: doc.processingStatus,
    startedAt: doc.processingStartedAt?.toISOString() ?? null,
    retryCount: doc.retryCount,
    canRetry: doc.retryCount < MAX_RETRY_COUNT
  }))

  return c.json({
    count: result.length,
    canRetryCount: result.filter(d => d.canRetry).length,
    permanentlyFailedCount: result.filter(d => !d.canRetry).length,
    documents: result
  })
})

// POST /api/cron/retry-stuck - Force retry all stuck documents
app.post('/retry-stuck', async (c) => {
  const forceRetry = c.req.query('force') === 'true'

  const fiveMinutesAgo = new Date(Date.now() - STUCK_THRESHOLD_MS)

  const stuckDocs = await prisma.document.findMany({
    where: {
      engagement: { status: { in: ['INTAKE_DONE', 'COLLECTING'] } },
      OR: [
        {
          processingStatus: { in: ['downloading', 'extracting', 'classifying', 'pending'] },
          processingStartedAt: { lt: fiveMinutesAgo }
        },
        { processingStatus: 'error' },
        { documentType: 'PROCESSING_ERROR' }
      ]
    }
  })

  let retriedCount = 0
  let skippedCount = 0

  for (const doc of stuckDocs) {
    if (doc.retryCount >= MAX_RETRY_COUNT && !forceRetry) {
      skippedCount++
      continue
    }

    await prisma.document.update({
      where: { id: doc.id },
      data: {
        documentType: 'PENDING',
        processingStatus: 'pending',
        processingStartedAt: null,
        issues: [],
        classifiedAt: null,
        ...(forceRetry ? { retryCount: 0 } : {})
      }
    })

    runInBackground(() => dispatch({
      type: 'document_uploaded',
      engagementId: doc.engagementId,
      documentId: doc.id,
      storageItemId: doc.storageItemId,
      fileName: doc.fileName
    }))

    console.log(`[CRON] Manual retry: ${doc.id} (${doc.fileName})${forceRetry ? ' [FORCED]' : ''}`)
    retriedCount++
  }

  return c.json({
    retried: retriedCount,
    skipped: skippedCount,
    forced: forceRetry
  })
})

// Retry documents stuck in processing or with errors
// Queries Document table directly — no longer needs engagements param
export async function retryStuckDocuments(): Promise<{ retried: number; permanentlyFailed: number }> {
  const fiveMinutesAgo = new Date(Date.now() - STUCK_THRESHOLD_MS)
  let retriedCount = 0
  let permanentlyFailedCount = 0

  const docs = await prisma.document.findMany({
    where: {
      engagement: { status: { in: ['INTAKE_DONE', 'COLLECTING'] } },
      OR: [
        {
          processingStatus: { in: ['downloading', 'extracting', 'classifying'] },
          processingStartedAt: { lt: fiveMinutesAgo }
        },
        { processingStatus: 'error' },
        { documentType: 'PROCESSING_ERROR' }
      ]
    }
  })

  for (const doc of docs) {
    if (doc.retryCount >= MAX_RETRY_COUNT) {
      if (doc.processingStatus !== 'error') {
        await prisma.document.update({
          where: { id: doc.id },
          data: {
            processingStatus: 'error',
            processingStartedAt: null,
            issues: doc.issues.some(i => i.includes('max retries'))
              ? doc.issues
              : [...doc.issues, `Processing failed after ${MAX_RETRY_COUNT} attempts. Please re-upload the document.`]
          }
        })
        permanentlyFailedCount++
        console.log(`[CRON] Document ${doc.id} (${doc.fileName}) permanently failed after ${MAX_RETRY_COUNT} retries`)
      }
      continue
    }

    const reason = doc.documentType === 'PROCESSING_ERROR' ? 'PROCESSING_ERROR' :
                   doc.processingStatus === 'error' ? 'error' : 'stuck'
    const retryNum = doc.retryCount + 1

    await prisma.document.update({
      where: { id: doc.id },
      data: {
        documentType: 'PENDING',
        processingStatus: 'pending',
        processingStartedAt: null,
        issues: [],
        classifiedAt: null
      }
    })

    runInBackground(() => dispatch({
      type: 'document_uploaded',
      engagementId: doc.engagementId,
      documentId: doc.id,
      storageItemId: doc.storageItemId,
      fileName: doc.fileName
    }))

    retriedCount++
    console.log(`[CRON] Retrying ${reason} document ${doc.id} (${doc.fileName}) - attempt ${retryNum}/${MAX_RETRY_COUNT}`)
  }

  return { retried: retriedCount, permanentlyFailed: permanentlyFailedCount }
}

export default app
