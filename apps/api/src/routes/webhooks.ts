import { Hono } from 'hono'
import crypto from 'crypto'
import { prisma } from '../lib/prisma.js'
import { generateChecklist } from '../lib/openai.js'
import { dispatch } from '../lib/agents/dispatcher.js'
import { runInBackground, runAllInBackground } from '../workers/background.js'
import { pollEngagement } from '../lib/poll-engagement.js'

const app = new Hono()

// In-memory dedup for demo (resets on deploy)
const processedEvents = new Set<string>()

// =====================================================
// DROPBOX WEBHOOKS
// https://www.dropbox.com/developers/reference/webhooks
// =====================================================

// GET /api/webhooks/dropbox - Verification challenge
// Dropbox sends this when you register/verify your webhook URI
app.get('/dropbox', (c) => {
  const challenge = c.req.query('challenge')
  
  if (!challenge) {
    console.log('[DROPBOX WEBHOOK] Missing challenge parameter')
    return c.text('Missing challenge', 400)
  }
  
  console.log('[DROPBOX WEBHOOK] Verification challenge received, echoing back')
  
  // Echo back the challenge with required headers
  return c.text(challenge, 200, {
    'Content-Type': 'text/plain',
    'X-Content-Type-Options': 'nosniff'
  })
})

// POST /api/webhooks/dropbox - File change notifications
// Dropbox sends this when files change in connected accounts
app.post('/dropbox', async (c) => {
  const rawBody = await c.req.text()
  const signature = c.req.header('X-Dropbox-Signature')
  
  // Verify signature (optional but recommended)
  if (!verifyDropboxSignature(rawBody, signature)) {
    console.log('[DROPBOX WEBHOOK] Invalid signature')
    return c.json({ error: 'Invalid signature' }, 403)
  }
  
  let payload: { list_folder?: { accounts?: string[] }; delta?: { users?: number[] } }
  try {
    payload = JSON.parse(rawBody)
  } catch {
    console.log('[DROPBOX WEBHOOK] Invalid JSON payload')
    return c.json({ error: 'Invalid JSON' }, 400)
  }
  
  // Extract account IDs from the notification
  const accountIds = payload.list_folder?.accounts || []
  const userIds = payload.delta?.users || []
  
  console.log(`[DROPBOX WEBHOOK] Received notification for ${accountIds.length} accounts, ${userIds.length} users`)
  
  // Trigger polling for all active engagements
  // Note: We poll ALL active engagements since our app uses shared links
  // and we don't currently track which Dropbox account owns which folder.
  // This is fast since pollEngagement only fetches deltas using cursors.
  runInBackground(async () => {
    const engagements = await prisma.engagement.findMany({
      where: { 
        status: { in: ['INTAKE_DONE', 'COLLECTING'] },
        storageProvider: 'dropbox'
      },
    })
    
    console.log(`[DROPBOX WEBHOOK] Polling ${engagements.length} active engagements`)
    
    // Run all polls concurrently
    runAllInBackground(engagements.map(engagement => () => pollEngagement(engagement)))
  })
  
  // Respond quickly to Dropbox (they require response within 10 seconds)
  return c.json({ status: 'ok' })
})

/**
 * Verify Dropbox webhook signature using HMAC-SHA256
 * The signature is the HMAC-SHA256 of the request body using the app secret as the key
 */
function verifyDropboxSignature(payload: string, signature: string | null | undefined): boolean {
  const appSecret = process.env.DROPBOX_APP_SECRET
  
  // If no app secret configured, skip verification (not recommended for production)
  if (!appSecret) {
    console.log('[DROPBOX WEBHOOK] DROPBOX_APP_SECRET not set, skipping signature verification')
    return true
  }
  
  if (!signature) {
    console.log('[DROPBOX WEBHOOK] No signature header provided')
    return false
  }
  
  const expectedSignature = crypto
    .createHmac('sha256', appSecret)
    .update(payload)
    .digest('hex')
  
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    )
  } catch (e) {
    console.log('[DROPBOX WEBHOOK] Signature verification error:', e)
    return false
  }
}

// POST /api/webhooks/typeform - Typeform webhook
app.post('/typeform', async (c) => {
  // Debug: log all headers
  console.log('[WEBHOOK] Headers:', Object.fromEntries(c.req.raw.headers.entries()))

  const rawBody = await c.req.text()
  const signature = c.req.header('typeform-signature')

  // Verify signature
  if (!verifySignature(rawBody, signature)) {
    return c.json({ error: 'Invalid signature' }, 401)
  }

  const payload = JSON.parse(rawBody)
  const eventId = payload.event_id

  // Simple dedup
  if (processedEvents.has(eventId)) {
    return c.json({ status: 'duplicate' })
  }
  processedEvents.add(eventId)

  const engagementId = payload.form_response?.hidden?.engagement_id
  if (!engagementId) {
    return c.json({ error: 'Missing engagement_id' }, 400)
  }

  // Process in background
  runInBackground(() => processIntake(engagementId, payload.form_response))

  return c.json({ status: 'processing' })
})

async function processIntake(engagementId: string, formResponse: unknown) {
  const engagement = await prisma.engagement.findUnique({
    where: { id: engagementId },
  })

  if (!engagement) {
    console.error(`Engagement not found: ${engagementId}`)
    return
  }

  // Generate checklist via LLM
  const checklist = await generateChecklist(formResponse, engagement.taxYear)

  await prisma.engagement.update({
    where: { id: engagementId },
    data: {
      status: 'INTAKE_DONE',
      intakeData: formResponse as object,
      checklist,
    },
  })

  console.log(`[INTAKE] Generated ${checklist.length} checklist items for ${engagementId}`)

  // Trigger Outreach Agent to send SharePoint instructions
  await dispatch({
    type: 'intake_complete',
    engagementId
  })
}

function verifySignature(payload: string, signature: string | null | undefined): boolean {
  if (!signature) {
    console.log('[WEBHOOK] No signature header provided')
    return false
  }
  const secret = process.env.TYPEFORM_WEBHOOK_SECRET
  if (!secret) {
    console.log('[WEBHOOK] TYPEFORM_WEBHOOK_SECRET not set')
    return false
  }

  const hash = crypto.createHmac('sha256', secret).update(payload).digest('base64')
  const expected = `sha256=${hash}`

  console.log('[WEBHOOK] Received signature:', signature)
  console.log('[WEBHOOK] Expected signature:', expected)
  console.log('[WEBHOOK] Secret length:', secret.length)

  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected)
    )
  } catch (e) {
    console.log('[WEBHOOK] timingSafeEqual error:', e)
    return false
  }
}

export default app
