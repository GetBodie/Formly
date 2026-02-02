import { Hono } from 'hono'
import crypto from 'crypto'
import { prisma } from '../lib/prisma.js'
import { generateChecklist } from '../lib/openai.js'
import { dispatch } from '../lib/agents/dispatcher.js'
import { runInBackground } from '../workers/background.js'

const app = new Hono()

// In-memory dedup for demo (resets on deploy)
const processedEvents = new Set<string>()

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
