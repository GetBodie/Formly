import { Hono } from 'hono'
import { prisma } from '../lib/prisma.js'
import { dispatch } from '../lib/agents/dispatcher.js'
import { runInBackground, runAllInBackground } from '../workers/background.js'
import { pollEngagement } from '../lib/poll-engagement.js'
import type { Document } from '../types.js'

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

  // Also retry stuck documents (processing for > 5 minutes, max 3 attempts)
  const stuckResult = await retryStuckDocuments(engagements)

  return c.json({ 
    queued: engagements.length, 
    retriedStuck: stuckResult.retried,
    permanentlyFailed: stuckResult.permanentlyFailed
  })
})

// GET /api/cron/check-reminders - Check for stale engagements and send reminders
app.get('/check-reminders', async (c) => {
  // Find engagements that need reminders:
  // - Status is INTAKE_DONE or COLLECTING
  // - No activity in the last 3 days
  // - Haven't exceeded max reminders (5)
  const threeDaysAgo = new Date()
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3)

  const staleEngagements = await prisma.engagement.findMany({
    where: {
      status: { in: ['INTAKE_DONE', 'COLLECTING'] },
      lastActivityAt: { lt: threeDaysAgo },
      reminderCount: { lt: 5 }
    }
  })

  // Process each stale engagement in background
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
  const engagements = await prisma.engagement.findMany({
    where: { status: { in: ['INTAKE_DONE', 'COLLECTING'] } },
  })

  const fiveMinutesAgo = new Date(Date.now() - STUCK_THRESHOLD_MS).toISOString()
  const stuckDocs: Array<{
    engagementId: string
    clientName: string
    documentId: string
    fileName: string
    status: string
    startedAt: string | null
    retryCount: number
    canRetry: boolean
  }> = []

  for (const engagement of engagements) {
    const documents = (engagement.documents as Document[]) || []
    
    for (const doc of documents) {
      const isProcessing = ['downloading', 'extracting', 'classifying', 'pending'].includes(doc.processingStatus || 'pending')
      const isStuck = isProcessing && doc.processingStartedAt && doc.processingStartedAt < fiveMinutesAgo
      const isError = doc.processingStatus === 'error' || doc.documentType === 'PROCESSING_ERROR'
      
      if (isStuck || isError) {
        const retryCount = doc.retryCount || 0
        stuckDocs.push({
          engagementId: engagement.id,
          clientName: engagement.clientName,
          documentId: doc.id,
          fileName: doc.fileName,
          status: doc.processingStatus || 'pending',
          startedAt: doc.processingStartedAt || null,
          retryCount,
          canRetry: retryCount < MAX_RETRY_COUNT
        })
      }
    }
  }

  return c.json({
    count: stuckDocs.length,
    canRetryCount: stuckDocs.filter(d => d.canRetry).length,
    permanentlyFailedCount: stuckDocs.filter(d => !d.canRetry).length,
    documents: stuckDocs
  })
})

// POST /api/cron/retry-stuck - Force retry all stuck documents (resets retry count)
app.post('/retry-stuck', async (c) => {
  const forceRetry = c.req.query('force') === 'true' // ?force=true resets retry count
  
  const engagements = await prisma.engagement.findMany({
    where: { status: { in: ['INTAKE_DONE', 'COLLECTING'] } },
  })

  const fiveMinutesAgo = new Date(Date.now() - STUCK_THRESHOLD_MS).toISOString()
  let retriedCount = 0
  let skippedCount = 0

  for (const engagement of engagements) {
    const documents = (engagement.documents as Document[]) || []
    let updated = false

    for (const doc of documents) {
      const isProcessing = ['downloading', 'extracting', 'classifying', 'pending'].includes(doc.processingStatus || 'pending')
      const isStuck = isProcessing && doc.processingStartedAt && doc.processingStartedAt < fiveMinutesAgo
      const isError = doc.processingStatus === 'error' || doc.documentType === 'PROCESSING_ERROR'
      
      if (isStuck || isError) {
        const retryCount = doc.retryCount || 0
        
        // Skip if at max retries unless force=true
        if (retryCount >= MAX_RETRY_COUNT && !forceRetry) {
          skippedCount++
          continue
        }

        // Reset document for retry
        doc.documentType = 'PENDING'
        doc.processingStatus = 'pending'
        doc.processingStartedAt = null
        doc.issues = []
        doc.classifiedAt = null
        if (forceRetry) {
          doc.retryCount = 0 // Reset retry count if forced
        }
        updated = true
        retriedCount++

        // Re-dispatch
        runInBackground(() => dispatch({
          type: 'document_uploaded',
          engagementId: engagement.id,
          documentId: doc.id,
          storageItemId: doc.storageItemId,
          fileName: doc.fileName
        }))

        console.log(`[CRON] Manual retry: ${doc.id} (${doc.fileName})${forceRetry ? ' [FORCED]' : ''}`)
      }
    }

    if (updated) {
      await prisma.engagement.update({
        where: { id: engagement.id },
        data: { documents }
      })
    }
  }

  return c.json({ 
    retried: retriedCount, 
    skipped: skippedCount,
    forced: forceRetry
  })
})

// Retry documents stuck in processing status for > 5 minutes OR with PROCESSING_ERROR
// Respects max retry count (3 attempts) to prevent infinite retry loops
export async function retryStuckDocuments(engagements: { id: string; documents: unknown }[]): Promise<{ retried: number; permanentlyFailed: number }> {
  const fiveMinutesAgo = new Date(Date.now() - STUCK_THRESHOLD_MS).toISOString()
  let retriedCount = 0
  let permanentlyFailedCount = 0

  for (const engagement of engagements) {
    const documents = (engagement.documents as Document[]) || []

    // Find documents that need retry:
    // 1. Stuck in processing (downloading/extracting/classifying) for > 5 minutes
    // 2. Have PROCESSING_ERROR type (failed extraction/classification)
    // 3. processingStatus is 'error' but not yet reached max retries
    const needsRetry = (doc: Document) => {
      const retryCount = doc.retryCount || 0
      if (retryCount >= MAX_RETRY_COUNT) return false // Already at max retries
      
      const isProcessing = ['downloading', 'extracting', 'classifying'].includes(doc.processingStatus || '')
      const isStuck = isProcessing &&
        doc.processingStartedAt &&
        doc.processingStartedAt < fiveMinutesAgo
      const hasError = doc.documentType === 'PROCESSING_ERROR' || doc.processingStatus === 'error'
      return isStuck || hasError
    }

    // Find docs that have exceeded max retries and need to be marked as permanently failed
    const isPermanentlyFailed = (doc: Document) => {
      const retryCount = doc.retryCount || 0
      if (retryCount < MAX_RETRY_COUNT) return false
      return doc.processingStatus !== 'classified' && doc.processingStatus !== 'error'
    }

    const docsToRetry = documents.filter(needsRetry)
    const docsToPermanentlyFail = documents.filter(isPermanentlyFailed)
    
    if (docsToRetry.length === 0 && docsToPermanentlyFail.length === 0) continue

    let updated = false

    // Mark permanently failed docs
    for (const doc of documents) {
      if (isPermanentlyFailed(doc)) {
        doc.processingStatus = 'error'
        doc.processingStartedAt = null
        if (!doc.issues.some(i => i.includes('max retries'))) {
          doc.issues.push(`Processing failed after ${MAX_RETRY_COUNT} attempts. Please re-upload the document.`)
        }
        updated = true
        permanentlyFailedCount++
        console.log(`[CRON] Document ${doc.id} (${doc.fileName}) permanently failed after ${MAX_RETRY_COUNT} retries`)
      }
    }

    // Reset and retry eligible documents
    for (const doc of documents) {
      if (needsRetry(doc)) {
        const reason = doc.documentType === 'PROCESSING_ERROR' ? 'PROCESSING_ERROR' : 
                       doc.processingStatus === 'error' ? 'error' : 'stuck'
        const retryNum = (doc.retryCount || 0) + 1
        doc.documentType = 'PENDING'
        doc.processingStatus = 'pending'
        doc.processingStartedAt = null
        doc.issues = []
        doc.classifiedAt = null
        // Note: retryCount will be incremented by runAssessmentFast when it runs
        updated = true
        retriedCount++

        // Re-dispatch the document_uploaded event
        runInBackground(() => dispatch({
          type: 'document_uploaded',
          engagementId: engagement.id,
          documentId: doc.id,
          storageItemId: doc.storageItemId,
          fileName: doc.fileName
        }))

        console.log(`[CRON] Retrying ${reason} document ${doc.id} (${doc.fileName}) - attempt ${retryNum}/${MAX_RETRY_COUNT}`)
      }
    }

    if (updated) {
      await prisma.engagement.update({
        where: { id: engagement.id },
        data: { documents }
      })
    }
  }

  return { retried: retriedCount, permanentlyFailed: permanentlyFailedCount }
}

export default app
