import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import documentRoutes from '../documents.js'
import { createMockEngagement, createMockDocument, resetIdCounter } from '../../test/factories.js'

// Mock dependencies
vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    engagement: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}))

vi.mock('../../lib/agents/reconciliation.js', () => ({
  runReconciliationAgent: vi.fn(async () => ({ isReady: false, completionPercentage: 50 })),
}))

vi.mock('../../lib/agents/assessment-fast.js', () => ({
  runAssessmentFast: vi.fn(async () => {}),
}))

vi.mock('../../lib/email.js', () => ({
  sendEmail: vi.fn(async () => ({ id: 'email_123' })),
}))

vi.mock('../../lib/openai.js', () => ({
  generateFollowUpEmail: vi.fn(async () => ({
    subject: 'Action Required: W-2 Issue',
    body: 'Your W-2 document needs attention...',
  })),
  generateFriendlyIssues: vi.fn(async () => [
    { title: 'Missing Information', description: 'SSN not visible', severity: 'high' },
  ]),
}))

import { prisma } from '../../lib/prisma.js'
import { runReconciliationAgent } from '../../lib/agents/reconciliation.js'
import { sendEmail } from '../../lib/email.js'

const app = new Hono().route('/api/engagements', documentRoutes)

function createRequest(path: string, options?: RequestInit): Request {
  return new Request(`http://localhost${path}`, options)
}

describe('Document Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetIdCounter()
  })

  describe('POST /api/engagements/:engagementId/documents/:docId/approve', () => {
    it('approves document and triggers reconciliation', async () => {
      const doc = createMockDocument({ id: 'doc_123', documentType: 'W-2' })
      const mockEngagement = createMockEngagement({
        id: 'eng_123',
        documents: [doc],
      })
      vi.mocked(prisma.engagement.findUnique).mockResolvedValueOnce(mockEngagement as any)
      vi.mocked(prisma.engagement.update).mockResolvedValueOnce(mockEngagement as any)

      const res = await app.request(
        createRequest('/api/engagements/eng_123/documents/doc_123/approve', {
          method: 'POST',
        })
      )

      expect(res.status).toBe(200)
      const data = await res.json() as any
      expect(data.success).toBe(true)
      expect(data.document.approved).toBe(true)
      expect(runReconciliationAgent).toHaveBeenCalled()
    })

    it('returns 404 for non-existent document', async () => {
      const mockEngagement = createMockEngagement({ id: 'eng_123', documents: [] })
      vi.mocked(prisma.engagement.findUnique).mockResolvedValueOnce(mockEngagement as any)

      const res = await app.request(
        createRequest('/api/engagements/eng_123/documents/doc_nonexistent/approve', {
          method: 'POST',
        })
      )

      expect(res.status).toBe(404)
      const data = await res.json() as any
      expect(data.error).toBe('Document not found')
    })

    it('returns 404 for non-existent engagement', async () => {
      vi.mocked(prisma.engagement.findUnique).mockResolvedValueOnce(null)

      const res = await app.request(
        createRequest('/api/engagements/eng_nonexistent/documents/doc_123/approve', {
          method: 'POST',
        })
      )

      expect(res.status).toBe(404)
      const data = await res.json() as any
      expect(data.error).toBe('Engagement not found')
    })
  })

  describe('POST /api/engagements/:engagementId/documents/:docId/reclassify', () => {
    it('reclassifies document to new type', async () => {
      const doc = createMockDocument({ id: 'doc_123', documentType: 'PENDING' })
      const mockEngagement = createMockEngagement({
        id: 'eng_123',
        documents: [doc],
      })
      vi.mocked(prisma.engagement.findUnique).mockResolvedValueOnce(mockEngagement as any)
      vi.mocked(prisma.engagement.update).mockResolvedValueOnce(mockEngagement as any)

      const res = await app.request(
        createRequest('/api/engagements/eng_123/documents/doc_123/reclassify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ newType: 'W-2' }),
        })
      )

      expect(res.status).toBe(200)
      const data = await res.json() as any
      expect(data.success).toBe(true)
      expect(data.document.documentType).toBe('W-2')
      expect(data.document.override).toBeDefined()
      expect(data.document.override.originalType).toBe('PENDING')
    })

    it('returns 400 for invalid document type', async () => {
      const doc = createMockDocument({ id: 'doc_123' })
      const mockEngagement = createMockEngagement({
        id: 'eng_123',
        documents: [doc],
      })
      vi.mocked(prisma.engagement.findUnique).mockResolvedValueOnce(mockEngagement as any)

      const res = await app.request(
        createRequest('/api/engagements/eng_123/documents/doc_123/reclassify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ newType: 'INVALID_TYPE' }),
        })
      )

      expect(res.status).toBe(400)
    })
  })

  describe('POST /api/engagements/:engagementId/documents/:docId/archive', () => {
    it('archives document with reason', async () => {
      const doc = createMockDocument({ id: 'doc_123', documentType: 'W-2' })
      const mockEngagement = createMockEngagement({
        id: 'eng_123',
        documents: [doc],
      })
      vi.mocked(prisma.engagement.findUnique).mockResolvedValueOnce(mockEngagement as any)
      vi.mocked(prisma.engagement.update).mockResolvedValueOnce(mockEngagement as any)

      const res = await app.request(
        createRequest('/api/engagements/eng_123/documents/doc_123/archive', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: 'Duplicate document' }),
        })
      )

      expect(res.status).toBe(200)
      const data = await res.json() as any
      expect(data.success).toBe(true)
      expect(data.document.archived).toBe(true)
      expect(data.document.archivedReason).toBe('Duplicate document')
    })
  })

  describe('POST /api/engagements/:engagementId/documents/:docId/unarchive', () => {
    it('restores archived document', async () => {
      const doc = createMockDocument({
        id: 'doc_123',
        documentType: 'W-2',
        archived: true,
        archivedAt: new Date().toISOString(),
      })
      const mockEngagement = createMockEngagement({
        id: 'eng_123',
        documents: [doc],
      })
      vi.mocked(prisma.engagement.findUnique).mockResolvedValueOnce(mockEngagement as any)
      vi.mocked(prisma.engagement.update).mockResolvedValueOnce(mockEngagement as any)

      const res = await app.request(
        createRequest('/api/engagements/eng_123/documents/doc_123/unarchive', {
          method: 'POST',
        })
      )

      expect(res.status).toBe(200)
      const data = await res.json() as any
      expect(data.success).toBe(true)
      expect(data.document.archived).toBe(false)
    })
  })

  describe('POST /api/engagements/:engagementId/documents/:docId/send-followup', () => {
    it('uses custom email content when provided', async () => {
      const doc = createMockDocument({
        id: 'doc_123',
        issues: ['SEVERITY:high TYPE:missing DETAILS:Issue'],
      })
      const mockEngagement = createMockEngagement({
        id: 'eng_123',
        storageFolderUrl: 'https://dropbox.com/test',
        documents: [doc],
      })
      vi.mocked(prisma.engagement.findUnique).mockResolvedValueOnce(mockEngagement as any)

      const res = await app.request(
        createRequest('/api/engagements/eng_123/documents/doc_123/send-followup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subject: 'Custom Subject',
            body: 'Custom email body',
            email: 'custom@example.com',
          }),
        })
      )

      expect(res.status).toBe(200)
      expect(sendEmail).toHaveBeenCalledWith(
        'custom@example.com',
        expect.objectContaining({ subject: 'Custom Subject' })
      )
    })
  })
})
