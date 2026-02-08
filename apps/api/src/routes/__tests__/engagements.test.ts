import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import engagementRoutes from '../engagements.js'
import { createMockEngagement, resetIdCounter } from '../../test/factories.js'

// Mock dependencies
vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    engagement: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}))

vi.mock('../../lib/storage/index.js', () => ({
  getStorageClient: vi.fn(() => ({
    resolveUrl: vi.fn(async () => ({ folderId: 'folder_123', driveId: null })),
  })),
  detectProvider: vi.fn(() => 'dropbox'),
}))

vi.mock('../../lib/agents/dispatcher.js', () => ({
  dispatch: vi.fn(async () => {}),
}))

vi.mock('../../lib/agents/reconciliation.js', () => ({
  runReconciliationAgent: vi.fn(async () => ({ isReady: false, completionPercentage: 50 })),
}))

vi.mock('../../lib/openai.js', () => ({
  generatePrepBrief: vi.fn(async () => 'Mock prep brief content'),
}))

vi.mock('../../workers/background.js', () => ({
  runInBackground: vi.fn((fn: () => void) => fn()),
}))

vi.mock('../../lib/poll-engagement.js', () => ({
  pollEngagement: vi.fn(async () => {}),
}))

import { prisma } from '../../lib/prisma.js'
import { dispatch } from '../../lib/agents/dispatcher.js'

const app = new Hono().route('/api/engagements', engagementRoutes)

function createRequest(path: string, options?: RequestInit): Request {
  return new Request(`http://localhost${path}`, options)
}

describe('Engagement Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetIdCounter()
    process.env.TYPEFORM_FORM_ID = 'form_123'
  })

  describe('GET /api/engagements', () => {
    it('returns list of all engagements', async () => {
      const mockEngagements = [
        createMockEngagement({ id: 'eng_001', clientName: 'Alice' }),
        createMockEngagement({ id: 'eng_002', clientName: 'Bob' }),
      ]
      vi.mocked(prisma.engagement.findMany).mockResolvedValueOnce(mockEngagements as any)

      const res = await app.request(createRequest('/api/engagements'))

      expect(res.status).toBe(200)
      const data = await res.json() as any[]
      expect(data).toHaveLength(2)
      expect(data[0].clientName).toBe('Alice')
      expect(data[1].clientName).toBe('Bob')
    })

    it('returns empty array when no engagements exist', async () => {
      vi.mocked(prisma.engagement.findMany).mockResolvedValueOnce([])

      const res = await app.request(createRequest('/api/engagements'))

      expect(res.status).toBe(200)
      const data = await res.json() as any[]
      expect(data).toEqual([])
    })
  })

  describe('POST /api/engagements', () => {
    it('creates new engagement with valid data', async () => {
      const newEngagement = createMockEngagement({
        id: 'eng_new',
        clientName: 'New Client',
        clientEmail: 'new@example.com',
      })
      vi.mocked(prisma.engagement.create).mockResolvedValueOnce(newEngagement as any)

      const res = await app.request(
        createRequest('/api/engagements', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientName: 'New Client',
            clientEmail: 'new@example.com',
            storageFolderUrl: 'https://www.dropbox.com/home/test-folder',
          }),
        })
      )

      expect(res.status).toBe(201)
      const data = await res.json() as any
      expect(data.clientName).toBe('New Client')
      expect(dispatch).toHaveBeenCalledWith({
        type: 'engagement_created',
        engagementId: 'eng_new',
      })
    })

    it('returns 400 for invalid email', async () => {
      const res = await app.request(
        createRequest('/api/engagements', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientName: 'Test',
            clientEmail: 'not-an-email',
            storageFolderUrl: 'https://www.dropbox.com/home/test',
          }),
        })
      )

      expect(res.status).toBe(400)
    })

    it('returns 400 for missing required fields', async () => {
      const res = await app.request(
        createRequest('/api/engagements', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientName: 'Test' }),
        })
      )

      expect(res.status).toBe(400)
    })
  })

  describe('GET /api/engagements/:id', () => {
    it('returns engagement by ID', async () => {
      const mockEngagement = createMockEngagement({ id: 'eng_123' })
      vi.mocked(prisma.engagement.findUnique).mockResolvedValueOnce(mockEngagement as any)

      const res = await app.request(createRequest('/api/engagements/eng_123'))

      expect(res.status).toBe(200)
      const data = await res.json() as any
      expect(data.id).toBe('eng_123')
    })

    it('returns 404 for non-existent engagement', async () => {
      vi.mocked(prisma.engagement.findUnique).mockResolvedValueOnce(null)

      const res = await app.request(createRequest('/api/engagements/eng_nonexistent'))

      expect(res.status).toBe(404)
      const data = await res.json() as any
      expect(data.error).toBe('Engagement not found')
    })
  })

  describe('PATCH /api/engagements/:id', () => {
    it('updates engagement status', async () => {
      const mockEngagement = createMockEngagement({ id: 'eng_123', status: 'PENDING' })
      vi.mocked(prisma.engagement.findUnique).mockResolvedValueOnce(mockEngagement as any)
      vi.mocked(prisma.engagement.update).mockResolvedValueOnce({
        ...mockEngagement,
        status: 'INTAKE_DONE',
      } as any)

      const res = await app.request(
        createRequest('/api/engagements/eng_123', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'INTAKE_DONE' }),
        })
      )

      expect(res.status).toBe(200)
      const data = await res.json() as any
      expect(data.status).toBe('INTAKE_DONE')
    })

    it('returns 404 when updating non-existent engagement', async () => {
      vi.mocked(prisma.engagement.findUnique).mockResolvedValueOnce(null)

      const res = await app.request(
        createRequest('/api/engagements/eng_nonexistent', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'READY' }),
        })
      )

      expect(res.status).toBe(404)
    })
  })

  describe('DELETE /api/engagements/:id', () => {
    it('deletes engagement successfully', async () => {
      const mockEngagement = createMockEngagement({ id: 'eng_123' })
      vi.mocked(prisma.engagement.findUnique).mockResolvedValueOnce(mockEngagement as any)
      vi.mocked(prisma.engagement.delete).mockResolvedValueOnce(mockEngagement as any)

      const res = await app.request(
        createRequest('/api/engagements/eng_123', { method: 'DELETE' })
      )

      expect(res.status).toBe(200)
      const data = await res.json() as any
      expect(data.message).toBe('Engagement deleted successfully')
    })

    it('returns 404 when deleting non-existent engagement', async () => {
      vi.mocked(prisma.engagement.findUnique).mockResolvedValueOnce(null)

      const res = await app.request(
        createRequest('/api/engagements/eng_nonexistent', { method: 'DELETE' })
      )

      expect(res.status).toBe(404)
    })
  })

  describe('POST /api/engagements/:id/brief', () => {
    it('generates prep brief for READY engagement', async () => {
      const mockEngagement = createMockEngagement({
        id: 'eng_123',
        status: 'READY',
        checklist: [{ id: 'item_1', title: 'W-2', status: 'received' }],
        documents: [{ id: 'doc_1', fileName: 'w2.pdf', documentType: 'W-2' }],
      })
      vi.mocked(prisma.engagement.findUnique).mockResolvedValueOnce(mockEngagement as any)
      vi.mocked(prisma.engagement.update).mockResolvedValueOnce({
        ...mockEngagement,
        prepBrief: 'Mock prep brief content',
      } as any)

      const res = await app.request(
        createRequest('/api/engagements/eng_123/brief', { method: 'POST' })
      )

      expect(res.status).toBe(200)
      const data = await res.json() as any
      expect(data.success).toBe(true)
      expect(data.brief).toBe('Mock prep brief content')
    })

    it('returns 400 for non-READY engagement', async () => {
      const mockEngagement = createMockEngagement({ id: 'eng_123', status: 'PENDING' })
      vi.mocked(prisma.engagement.findUnique).mockResolvedValueOnce(mockEngagement as any)

      const res = await app.request(
        createRequest('/api/engagements/eng_123/brief', { method: 'POST' })
      )

      expect(res.status).toBe(400)
      const data = await res.json() as any
      expect(data.error).toContain('READY status')
    })
  })

  describe('POST /api/engagements/:id/reconcile', () => {
    it('triggers manual reconciliation', async () => {
      const mockEngagement = createMockEngagement({ id: 'eng_123' })
      vi.mocked(prisma.engagement.findUnique).mockResolvedValueOnce(mockEngagement as any)

      const res = await app.request(
        createRequest('/api/engagements/eng_123/reconcile', { method: 'POST' })
      )

      expect(res.status).toBe(200)
      const data = await res.json() as any
      expect(data.message).toBe('Reconciliation complete')
      expect(data.completionPercentage).toBe(50)
    })
  })
})

describe('Engagement Status Transitions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetIdCounter()
    process.env.TYPEFORM_FORM_ID = 'form_123'
  })

  it('PENDING → INTAKE_DONE transition', async () => {
    const mockEngagement = createMockEngagement({ id: 'eng_123', status: 'PENDING' })
    vi.mocked(prisma.engagement.findUnique).mockResolvedValueOnce(mockEngagement as any)
    vi.mocked(prisma.engagement.update).mockResolvedValueOnce({
      ...mockEngagement,
      status: 'INTAKE_DONE',
    } as any)

    const res = await app.request(
      createRequest('/api/engagements/eng_123', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'INTAKE_DONE' }),
      })
    )

    expect(res.status).toBe(200)
    const data = await res.json() as any
    expect(data.status).toBe('INTAKE_DONE')
  })

  it('INTAKE_DONE → COLLECTING transition', async () => {
    const mockEngagement = createMockEngagement({ id: 'eng_123', status: 'INTAKE_DONE' })
    vi.mocked(prisma.engagement.findUnique).mockResolvedValueOnce(mockEngagement as any)
    vi.mocked(prisma.engagement.update).mockResolvedValueOnce({
      ...mockEngagement,
      status: 'COLLECTING',
    } as any)

    const res = await app.request(
      createRequest('/api/engagements/eng_123', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'COLLECTING' }),
      })
    )

    expect(res.status).toBe(200)
    const data = await res.json() as any
    expect(data.status).toBe('COLLECTING')
  })

  it('COLLECTING → READY transition', async () => {
    const mockEngagement = createMockEngagement({ id: 'eng_123', status: 'COLLECTING' })
    vi.mocked(prisma.engagement.findUnique).mockResolvedValueOnce(mockEngagement as any)
    vi.mocked(prisma.engagement.update).mockResolvedValueOnce({
      ...mockEngagement,
      status: 'READY',
    } as any)

    const res = await app.request(
      createRequest('/api/engagements/eng_123', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'READY' }),
      })
    )

    expect(res.status).toBe(200)
    const data = await res.json() as any
    expect(data.status).toBe('READY')
  })
})

describe('Full Engagement CRUD Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetIdCounter()
    process.env.TYPEFORM_FORM_ID = 'form_123'
  })

  it('complete lifecycle: create → read → update → delete', async () => {
    const createdEngagement = createMockEngagement({
      id: 'eng_lifecycle',
      clientName: 'Lifecycle Test',
      status: 'PENDING',
    })

    // CREATE
    vi.mocked(prisma.engagement.create).mockResolvedValueOnce(createdEngagement as any)
    const createRes = await app.request(
      createRequest('/api/engagements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientName: 'Lifecycle Test',
          clientEmail: 'lifecycle@example.com',
          storageFolderUrl: 'https://www.dropbox.com/home/lifecycle',
        }),
      })
    )
    expect(createRes.status).toBe(201)
    const created = await createRes.json() as any
    expect(created.id).toBe('eng_lifecycle')

    // READ
    vi.mocked(prisma.engagement.findUnique).mockResolvedValueOnce(createdEngagement as any)
    const readRes = await app.request(createRequest('/api/engagements/eng_lifecycle'))
    expect(readRes.status).toBe(200)
    const read = await readRes.json() as any
    expect(read.clientName).toBe('Lifecycle Test')

    // UPDATE
    const updatedEngagement = { ...createdEngagement, status: 'READY' }
    vi.mocked(prisma.engagement.findUnique).mockResolvedValueOnce(createdEngagement as any)
    vi.mocked(prisma.engagement.update).mockResolvedValueOnce(updatedEngagement as any)
    const updateRes = await app.request(
      createRequest('/api/engagements/eng_lifecycle', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'READY' }),
      })
    )
    expect(updateRes.status).toBe(200)
    const updated = await updateRes.json() as any
    expect(updated.status).toBe('READY')

    // DELETE
    vi.mocked(prisma.engagement.findUnique).mockResolvedValueOnce(updatedEngagement as any)
    vi.mocked(prisma.engagement.delete).mockResolvedValueOnce(updatedEngagement as any)
    const deleteRes = await app.request(
      createRequest('/api/engagements/eng_lifecycle', { method: 'DELETE' })
    )
    expect(deleteRes.status).toBe(200)
    const deleted = await deleteRes.json() as any
    expect(deleted.message).toBe('Engagement deleted successfully')
  })
})
