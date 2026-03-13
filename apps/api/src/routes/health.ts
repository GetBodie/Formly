import { Hono } from 'hono'
import { prisma } from '../lib/prisma.js'

const app = new Hono()

interface CheckResult {
  name: string
  status: 'ok' | 'degraded' | 'down'
  responseMs: number
  error?: string
  details?: Record<string, unknown>
}

async function checkDatabase(): Promise<CheckResult> {
  const start = performance.now()
  try {
    await prisma.$queryRaw<[{ now: Date }]>`SELECT NOW() as now`
    const ms = Math.round(performance.now() - start)
    return { name: 'database', status: ms > 2000 ? 'degraded' : 'ok', responseMs: ms }
  } catch (err: unknown) {
    return { name: 'database', status: 'down', responseMs: Math.round(performance.now() - start), error: err instanceof Error ? err.message : String(err) }
  }
}

async function checkEngagementStats(): Promise<CheckResult> {
  const start = performance.now()
  try {
    const total = await prisma.engagement.count()
    const ms = Math.round(performance.now() - start)
    return {
      name: 'engagements',
      status: 'ok',
      responseMs: ms,
      details: { total },
    }
  } catch (err: unknown) {
    return { name: 'engagements', status: 'down', responseMs: Math.round(performance.now() - start), error: err instanceof Error ? err.message : String(err) }
  }
}

async function checkRecentActivity(): Promise<CheckResult> {
  const start = performance.now()
  try {
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const recentlyUpdated = await prisma.engagement.count({
      where: { updatedAt: { gte: oneWeekAgo } },
    })
    const recentlyCreated = await prisma.engagement.count({
      where: { createdAt: { gte: oneWeekAgo } },
    })
    const ms = Math.round(performance.now() - start)
    return {
      name: 'recent_activity',
      status: 'ok',
      responseMs: ms,
      details: { updatedLastWeek: recentlyUpdated, createdLastWeek: recentlyCreated },
    }
  } catch (err: unknown) {
    return { name: 'recent_activity', status: 'down', responseMs: Math.round(performance.now() - start), error: err instanceof Error ? err.message : String(err) }
  }
}

function checkEnvironment(): CheckResult {
  const start = performance.now()
  const required = ['DATABASE_URL']
  const optional = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'MISTRAL_API_KEY', 'RESEND_API_KEY']
  const missing = required.filter(k => !process.env[k])
  const configured = optional.filter(k => !!process.env[k])

  return {
    name: 'environment',
    status: missing.length > 0 ? 'down' : 'ok',
    responseMs: Math.round(performance.now() - start),
    details: {
      nodeEnv: process.env.NODE_ENV || 'development',
      missingRequired: missing.length > 0 ? missing : undefined,
      configuredOptional: configured,
      scheduler: process.env.ENABLE_SCHEDULER !== 'false',
    },
  }
}

// ── Deep health check ────────────────────────────────────────────
app.get('/deep', async (c) => {
  const start = performance.now()

  const checks = await Promise.all([
    checkDatabase(),
    checkEngagementStats(),
    checkRecentActivity(),
    Promise.resolve(checkEnvironment()),
  ])

  const totalMs = Math.round(performance.now() - start)
  const hasDown = checks.some(ch => ch.status === 'down')
  const hasDegraded = checks.some(ch => ch.status === 'degraded')
  const overallStatus = hasDown ? 'down' : hasDegraded ? 'degraded' : 'ok'

  // Set appropriate status code
  const statusCode = overallStatus === 'down' ? 503 : overallStatus === 'degraded' ? 200 : 200

  return c.json({
    status: overallStatus,
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    totalMs,
    checks,
  }, statusCode)
})

// ── Summary (lightweight, CORS-friendly) ─────────────────────────
app.get('/summary', async (c) => {
  // Allow cross-origin for MC dashboard
  c.header('Access-Control-Allow-Origin', '*')

  try {
    await prisma.$queryRaw`SELECT 1`
    const engagements = await prisma.engagement.count()

    return c.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      uptime: Math.floor(process.uptime()),
      engagements,
    })
  } catch {
    return c.json({ status: 'down', timestamp: new Date().toISOString() }, 503)
  }
})

export default app
