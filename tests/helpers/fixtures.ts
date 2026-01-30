import type { ChecklistItem, Document, Reconciliation } from '@/types'

/**
 * Factory for creating test engagement data
 */
export function createEngagement(overrides: Partial<{
  id: string
  clientName: string
  clientEmail: string
  taxYear: number
  status: string
  storageProvider: string
  storageFolderUrl: string
  storageFolderId: string | null
  storageDriveId: string | null
  storagePageToken: string | null
  // Legacy fields
  sharepointFolderUrl: string | null
  sharepointDriveId: string | null
  sharepointFolderId: string | null
  deltaLink: string | null
  typeformFormId: string
  checklist: ChecklistItem[] | null
  documents: Document[] | null
  reconciliation: Reconciliation | null
  intakeData: unknown
  prepBrief: string | null
  agentLog: unknown[] | null
  reminderCount: number
  lastActivityAt: Date
  createdAt: Date
  updatedAt: Date
}> = {}) {
  return {
    id: 'eng-test-123',
    clientName: 'Test Client',
    clientEmail: 'test@example.com',
    taxYear: 2024,
    status: 'PENDING',
    storageProvider: 'sharepoint',
    storageFolderUrl: 'https://sharepoint.com/sites/test/folder',
    storageFolderId: 'folder-123',
    storageDriveId: 'drive-123',
    storagePageToken: null,
    // Legacy fields
    sharepointFolderUrl: 'https://sharepoint.com/sites/test/folder',
    sharepointDriveId: 'drive-123',
    sharepointFolderId: 'folder-123',
    deltaLink: null,
    typeformFormId: 'form-123',
    checklist: null,
    documents: null,
    reconciliation: null,
    intakeData: null,
    prepBrief: null,
    agentLog: null,
    reminderCount: 0,
    lastActivityAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

/**
 * Factory for creating test checklist items
 */
export function createChecklistItem(overrides: Partial<ChecklistItem> = {}): ChecklistItem {
  return {
    id: 'item-1',
    title: 'W-2 Form',
    why: 'Required to report wage income',
    priority: 'high',
    status: 'pending',
    documentIds: [],
    ...overrides,
  }
}

/**
 * Factory for creating test documents
 */
export function createDocument(overrides: Partial<Document> = {}): Document {
  return {
    id: 'doc-1',
    fileName: 'w2-2024.pdf',
    storageItemId: 'sp-item-1',
    sharepointItemId: 'sp-item-1', // Legacy
    documentType: 'W-2',
    confidence: 0.95,
    taxYear: 2024,
    issues: [],
    classifiedAt: new Date().toISOString(),
    ...overrides,
  }
}

/**
 * Factory for creating test reconciliation
 */
export function createReconciliation(overrides: Partial<Reconciliation> = {}): Reconciliation {
  return {
    completionPercentage: 0,
    itemStatuses: [],
    issues: [],
    ranAt: new Date().toISOString(),
    ...overrides,
  }
}
