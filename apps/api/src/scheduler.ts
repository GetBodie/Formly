import cron from 'node-cron'
import { prisma } from './lib/prisma.js'
import { pollEngagement } from './lib/poll-engagement.js'
import { dispatch } from './lib/agents/dispatcher.js'
import { retryStuckDocuments } from './routes/cron.js'
import { runInBackground, runAllInBackground } from './workers/background.js'

/**
 * Initialize scheduled tasks for the API server.
 * Calls business logic directly instead of going through HTTP.
 */
export function initScheduler() {
  // Poll storage for new documents every 2 minutes
  cron.schedule('*/2 * * * *', async () => {
    console.log('[SCHEDULER] Running poll-storage job')
    try {
      const engagements = await prisma.engagement.findMany({
        where: { status: { in: ['INTAKE_DONE', 'COLLECTING'] } },
      })

      runAllInBackground(engagements.map(engagement => () => pollEngagement(engagement)))

      const stuckResult = await retryStuckDocuments(engagements)

      console.log('[SCHEDULER] poll-storage result:', {
        queued: engagements.length,
        retriedStuck: stuckResult.retried,
        permanentlyFailed: stuckResult.permanentlyFailed,
      })
    } catch (error) {
      console.error('[SCHEDULER] poll-storage error:', error)
    }
  })

  // Check for stale engagements daily at 9 AM UTC
  cron.schedule('0 9 * * *', async () => {
    console.log('[SCHEDULER] Running check-reminders job')
    try {
      const threeDaysAgo = new Date()
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3)

      const staleEngagements = await prisma.engagement.findMany({
        where: {
          status: { in: ['INTAKE_DONE', 'COLLECTING'] },
          lastActivityAt: { lt: threeDaysAgo },
          reminderCount: { lt: 5 },
        },
      })

      for (const engagement of staleEngagements) {
        runInBackground(() => dispatch({
          type: 'stale_engagement',
          engagementId: engagement.id,
        }))
      }

      console.log('[SCHEDULER] check-reminders result:', {
        checked: staleEngagements.length,
      })
    } catch (error) {
      console.error('[SCHEDULER] check-reminders error:', error)
    }
  })

  console.log('[SCHEDULER] Cron jobs initialized:')
  console.log('  - poll-storage: every 2 minutes')
  console.log('  - check-reminders: daily at 9 AM UTC')
}
