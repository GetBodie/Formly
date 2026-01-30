import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET } from '@/app/api/cron/poll-storage/route'
import { NextRequest } from 'next/server'

// Mock dependencies
vi.mock('@/lib/prisma', () => ({
  prisma: {
    engagement: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}))

vi.mock('@/lib/storage', () => ({
  getStorageClient: vi.fn(),
}))

vi.mock('@/lib/agents/dispatcher', () => ({
  dispatch: vi.fn(),
}))

vi.mock('@vercel/functions', () => ({
  waitUntil: vi.fn((promise) => promise),
}))

import { prisma } from '@/lib/prisma'

describe('GET /api/cron/poll-storage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = 'test-secret'
  })

  it('returns 401 without authorization', async () => {
    const request = new NextRequest('http://localhost/api/cron/poll-storage')

    const response = await GET(request)

    expect(response.status).toBe(401)
  })

  it('returns 401 with wrong secret', async () => {
    const request = new NextRequest('http://localhost/api/cron/poll-storage', {
      headers: { authorization: 'Bearer wrong-secret' },
    })

    const response = await GET(request)

    expect(response.status).toBe(401)
  })

  it('queries engagements in INTAKE_DONE or COLLECTING status', async () => {
    vi.mocked(prisma.engagement.findMany).mockResolvedValue([])

    const request = new NextRequest('http://localhost/api/cron/poll-storage', {
      headers: { authorization: 'Bearer test-secret' },
    })

    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.queued).toBe(0)
    expect(prisma.engagement.findMany).toHaveBeenCalledWith({
      where: { status: { in: ['INTAKE_DONE', 'COLLECTING'] } },
    })
  })

  it('returns count of queued engagements', async () => {
    vi.mocked(prisma.engagement.findMany).mockResolvedValue([
      { id: 'eng-1' },
      { id: 'eng-2' },
      { id: 'eng-3' },
    ] as never)

    const request = new NextRequest('http://localhost/api/cron/poll-storage', {
      headers: { authorization: 'Bearer test-secret' },
    })

    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.queued).toBe(3)
  })
})
