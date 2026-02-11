import { z } from 'zod'

// All classifiable document types (used by classifier agent and checklist generation)
export const CLASSIFIABLE_DOCUMENT_TYPES = [
  // Personal Income
  'W-2', '1099-NEC', '1099-INT', '1099-DIV', '1099-B', '1099-R', '1099-MISC', '1099-G', '1099-K', 'SSA-1099',
  // Deductions & Credits
  '1098', '1098-T', 'SCHEDULE-A', 'SCHEDULE-C', 'SCHEDULE-D', 'SCHEDULE-E',
  // Business
  'K-1', 'FORM-1065', 'FORM-1120-S', 'FORM-941',
  // Generic
  'RECEIPT', 'STATEMENT', 'OTHER',
] as const
export type ClassifiableDocumentType = (typeof CLASSIFIABLE_DOCUMENT_TYPES)[number]

// Shared constant for document types (superset includes PENDING for unprocessed docs)
export const DOCUMENT_TYPES = [...CLASSIFIABLE_DOCUMENT_TYPES, 'PENDING'] as const
export type DocumentType = (typeof DOCUMENT_TYPES)[number]

export const ChecklistItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  why: z.string(),
  priority: z.enum(['high', 'medium', 'low']),
  status: z.enum(['pending', 'received', 'complete']),
  documentIds: z.array(z.string()),
  expectedDocumentType: z.enum(CLASSIFIABLE_DOCUMENT_TYPES as unknown as [string, ...string[]]).nullable(),
})

// Friendly issue format for cached LLM-generated messages
export const FriendlyIssueSchema = z.object({
  original: z.string(),
  friendlyMessage: z.string(),
  suggestedAction: z.string(),
  severity: z.enum(['error', 'warning'])
})

// DocumentSchema kept for API validation / backwards compat.
// Source of truth for document shape is now the Prisma Document model.
export const DocumentSchema = z.object({
  id: z.string(),
  fileName: z.string(),
  storageItemId: z.string(),
  documentType: z.string(),
  confidence: z.number(),
  taxYear: z.number().nullable(),
  issues: z.array(z.string()),
  issueDetails: z.array(FriendlyIssueSchema).nullable().default(null),
  classifiedAt: z.string().nullable(),
  processingStatus: z.enum(['pending', 'downloading', 'extracting', 'classifying', 'classified', 'error']).optional(),
  processingStartedAt: z.string().nullable().optional(),
  retryCount: z.number().optional().default(0),
  approvedAt: z.string().nullable().default(null),
  override: z.object({
    originalType: z.string(),
    reason: z.string(),
  }).nullable().default(null),
  archivedAt: z.string().nullable().default(null),
  archivedReason: z.string().nullable().default(null),
})

export const ReconciliationSchema = z.object({
  completionPercentage: z.number(),
  itemStatuses: z.array(z.object({
    itemId: z.string(),
    status: z.enum(['pending', 'received', 'complete']),
    documentIds: z.array(z.string()),
  })),
  issues: z.array(z.string()),
  ranAt: z.string(),
})

export type ChecklistItem = z.infer<typeof ChecklistItemSchema>
export type Document = z.infer<typeof DocumentSchema>
export type FriendlyIssue = z.infer<typeof FriendlyIssueSchema>
export type Reconciliation = z.infer<typeof ReconciliationSchema>
