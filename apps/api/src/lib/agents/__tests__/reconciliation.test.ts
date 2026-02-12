/**
 * Tests for the Reconciliation Agent
 * 
 * Covers: checkReady logic including the all-docs-approved condition (#80)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock prisma before importing the module
vi.mock('../../prisma.js', () => ({
  prisma: {
    engagement: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}))

vi.mock('../../openai.js', () => ({
  generatePrepBrief: vi.fn().mockResolvedValue('Test brief'),
}))

// Import after mocks
import { runReconciliationAgent } from '../reconciliation.js'
import { prisma } from '../../prisma.js'

describe('Reconciliation Agent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('checkReady - all docs approved condition (#80)', () => {
    it('should mark engagement READY when all documents are approved', async () => {
      const mockEngagement = {
        id: 'eng_123',
        clientName: 'Test Client',
        taxYear: 2024,
        status: 'COLLECTING',
        checklist: [
          { id: 'item_1', title: 'W-2', priority: 'high', status: 'pending', documentIds: [], expectedDocumentType: 'W-2' },
        ],
        documents: [
          { id: 'doc_1', documentType: 'W-2', approvedAt: new Date(), issues: [], archivedAt: null },
          { id: 'doc_2', documentType: '1099', approvedAt: new Date(), issues: [], archivedAt: null },
        ],
        agentLog: [],
      }

      vi.mocked(prisma.engagement.findUnique).mockResolvedValue(mockEngagement as never)
      vi.mocked(prisma.engagement.update).mockResolvedValue({ ...mockEngagement, status: 'READY' } as never)

      const result = await runReconciliationAgent({
        trigger: 'check_completion',
        engagementId: 'eng_123',
      })

      expect(result.isReady).toBe(true)
      expect(prisma.engagement.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'READY',
          }),
        })
      )
    })

    it('should NOT mark READY when some documents are not approved', async () => {
      const mockEngagement = {
        id: 'eng_123',
        clientName: 'Test Client',
        taxYear: 2024,
        status: 'COLLECTING',
        checklist: [
          { id: 'item_1', title: 'W-2', priority: 'high', status: 'pending', documentIds: [], expectedDocumentType: 'W-2' },
        ],
        documents: [
          { id: 'doc_1', documentType: 'W-2', approvedAt: new Date(), issues: [], archivedAt: null },
          { id: 'doc_2', documentType: '1099', approvedAt: null, issues: ['Missing info'], archivedAt: null },
        ],
        agentLog: [],
      }

      vi.mocked(prisma.engagement.findUnique).mockResolvedValue(mockEngagement as never)
      vi.mocked(prisma.engagement.update).mockResolvedValue(mockEngagement as never)

      const result = await runReconciliationAgent({
        trigger: 'check_completion',
        engagementId: 'eng_123',
      })

      expect(result.isReady).toBe(false)
    })

    it('should mark READY when high priority items complete even if completion < 100%', async () => {
      const mockEngagement = {
        id: 'eng_123',
        clientName: 'Test Client',
        taxYear: 2024,
        status: 'COLLECTING',
        checklist: [
          { id: 'item_1', title: 'W-2', priority: 'high', status: 'complete', documentIds: ['doc_1'], expectedDocumentType: 'W-2' },
          { id: 'item_2', title: 'Other', priority: 'low', status: 'pending', documentIds: [], expectedDocumentType: 'OTHER' },
        ],
        documents: [
          { id: 'doc_1', documentType: 'W-2', approvedAt: new Date(), issues: [], archivedAt: null },
        ],
        agentLog: [],
      }

      vi.mocked(prisma.engagement.findUnique).mockResolvedValue(mockEngagement as never)
      vi.mocked(prisma.engagement.update).mockResolvedValue({ ...mockEngagement, status: 'READY' } as never)

      const result = await runReconciliationAgent({
        trigger: 'check_completion',
        engagementId: 'eng_123',
      })

      expect(result.isReady).toBe(true)
    })

    it('should exclude archived documents from approval check', async () => {
      const mockEngagement = {
        id: 'eng_123',
        clientName: 'Test Client',
        taxYear: 2024,
        status: 'COLLECTING',
        checklist: [
          { id: 'item_1', title: 'W-2', priority: 'high', status: 'pending', documentIds: [], expectedDocumentType: 'W-2' },
        ],
        documents: [
          { id: 'doc_1', documentType: 'W-2', approvedAt: new Date(), issues: [], archivedAt: null },
          { id: 'doc_2', documentType: '1099', approvedAt: null, issues: [], archivedAt: new Date() }, // Archived, should be ignored
        ],
        agentLog: [],
      }

      vi.mocked(prisma.engagement.findUnique).mockResolvedValue(mockEngagement as never)
      vi.mocked(prisma.engagement.update).mockResolvedValue({ ...mockEngagement, status: 'READY' } as never)

      const result = await runReconciliationAgent({
        trigger: 'check_completion',
        engagementId: 'eng_123',
      })

      // Only non-archived doc_1 is considered, and it's approved
      expect(result.isReady).toBe(true)
    })
  })
})
