import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import cronRoutes from '../cron.js'
import { createMockEngagement, resetIdCounter } from '../../test/factories.js'

// Mock dependencies
vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    engagement: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    document: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}))

vi.mock('../../lib/poll-engagement.js', () => ({
  pollEngagement: vi.fn(async () => {}),
}))

vi.mock('../../lib/agents/dispatcher.js', () => ({
  dispatch: vi.fn(async () => {}),
}))

vi.mock('../../workers/background.js', () => ({
  runInBackground: vi.fn((fn: () => void) => fn()),
  runAllInBackground: vi.fn((fns: Array<() => void>) => fns.forEach((fn) => fn())),
}))

import { prisma } from '../../lib/prisma.js'
import { dispatch } from '../../lib/agents/dispatcher.js'

const app = new Hono().route('/api/cron', cronRoutes)

function createRequest(path: string, options?: RequestInit): Request {
  const headers = new Headers(options?.headers)
  headers.set('authorization', `Bearer ${process.env.CRON_SECRET}`)
  return new Request(`http://localhost${path}`, { ...options, headers })
}

describe('Cron Routes', () => {
  const cronSecret = 'test-cron-secret'

  beforeEach(() => {
    vi.clearAllMocks()
    resetIdCounter()
    process.env.CRON_SECRET = cronSecret
  })

  describe('Authorization', () => {
    it('returns 401 for missing authorization', async () => {
      const res = await app.request(
        new Request('http://localhost/api/cron/poll-storage')
      )

      expect(res.status).toBe(401)
      const data = (await res.json()) as Record<string, unknown>
      expect(data.error).toBe('Unauthorized')
    })

    it('returns 401 for invalid authorization', async () => {
      const res = await app.request(
        new Request('http://localhost/api/cron/poll-storage', {
          headers: { authorization: 'Bearer wrong-secret' },
        })
      )

      expect(res.status).toBe(401)
    })
  })

  describe('GET /api/cron/poll-storage', () => {
    it('polls storage for all COLLECTING engagements', async () => {
      const engagements = [
        createMockEngagement({
          id: 'eng_1',
          status: 'COLLECTING',
          storageProvider: 'dropbox',
          storageFolderId: '/folder1',
        }),
        createMockEngagement({
          id: 'eng_2',
          status: 'INTAKE_DONE',
          storageProvider: 'dropbox',
          storageFolderId: '/folder2',
        }),
      ]
      vi.mocked(prisma.engagement.findMany).mockResolvedValueOnce(engagements as any)
      // retryStuckDocuments queries prisma.document.findMany
      vi.mocked(prisma.document.findMany).mockResolvedValueOnce([])

      const res = await app.request(createRequest('/api/cron/poll-storage'))

      expect(res.status).toBe(200)
      const data = (await res.json()) as Record<string, unknown>
      expect(data.queued).toBe(2)
    })

    it('retries stuck documents', async () => {
      const stuckDoc = {
        id: 'doc_stuck',
        engagementId: 'eng_1',
        processingStatus: 'downloading',
        processingStartedAt: new Date(Date.now() - 6 * 60 * 1000),
        documentType: 'PENDING',
        retryCount: 0,
        fileName: 'test.pdf',
        storageItemId: 'storage_001',
        issues: [],
      }

      vi.mocked(prisma.engagement.findMany).mockResolvedValueOnce([])
      vi.mocked(prisma.document.findMany).mockResolvedValueOnce([stuckDoc] as any)
      vi.mocked(prisma.document.update).mockResolvedValue({} as any)

      const res = await app.request(createRequest('/api/cron/poll-storage'))

      expect(res.status).toBe(200)
      const data = (await res.json()) as Record<string, unknown>
      expect(data.retriedStuck).toBeGreaterThanOrEqual(1)
    })

    it('retries documents with PROCESSING_ERROR type', async () => {
      const errorDoc = {
        id: 'doc_error',
        engagementId: 'eng_1',
        documentType: 'PROCESSING_ERROR',
        processingStatus: 'classified',
        retryCount: 0,
        fileName: 'error.pdf',
        storageItemId: 'storage_002',
        issues: [],
      }

      vi.mocked(prisma.engagement.findMany).mockResolvedValueOnce([])
      vi.mocked(prisma.document.findMany).mockResolvedValueOnce([errorDoc] as any)
      vi.mocked(prisma.document.update).mockResolvedValue({} as any)

      const res = await app.request(createRequest('/api/cron/poll-storage'))

      expect(res.status).toBe(200)
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'document_uploaded',
          engagementId: 'eng_1',
        })
      )
    })
  })

  describe('GET /api/cron/check-reminders', () => {
    it('finds stale engagements and dispatches reminders', async () => {
      const fourDaysAgo = new Date()
      fourDaysAgo.setDate(fourDaysAgo.getDate() - 4)

      const staleEngagements = [
        createMockEngagement({
          id: 'eng_stale',
          status: 'COLLECTING',
          lastActivityAt: fourDaysAgo,
        }),
      ]
      vi.mocked(prisma.engagement.findMany).mockResolvedValueOnce(staleEngagements as any)

      const res = await app.request(createRequest('/api/cron/check-reminders'))

      expect(res.status).toBe(200)
      const data = (await res.json()) as Record<string, unknown>
      expect(data.checked).toBe(1)
      expect(data.engagementIds).toContain('eng_stale')

      expect(dispatch).toHaveBeenCalledWith({
        type: 'stale_engagement',
        engagementId: 'eng_stale',
      })
    })

    it('returns empty list when no stale engagements', async () => {
      vi.mocked(prisma.engagement.findMany).mockResolvedValueOnce([])

      const res = await app.request(createRequest('/api/cron/check-reminders'))

      expect(res.status).toBe(200)
      const data = (await res.json()) as Record<string, unknown>
      expect(data.checked).toBe(0)
      expect(data.engagementIds).toEqual([])
    })
  })
})
