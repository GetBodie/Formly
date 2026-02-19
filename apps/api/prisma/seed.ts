import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('Seeding database...')

  console.log('Deleting all existing engagements...')
  await prisma.engagement.deleteMany()

  console.log('Creating engagement 1: John Smith')
  await prisma.engagement.create({
    data: {
      clientName: 'John Smith',
      clientEmail: 'jsmith@gmail.com',
      taxYear: 2026,
      status: 'PENDING',
      storageProvider: 'dropbox',
      storageFolderUrl: 'https://www.dropbox.com/home/tax-docs',
      typeformFormId: 'dummy-form-id',
    },
  })

  console.log('Creating engagement 2: Tom Hanson (with documents)')
  await prisma.engagement.create({
    data: {
      clientName: 'Tom Hanson',
      clientEmail: 'thanson@gmail.com',
      taxYear: 2026,
      status: 'READY',
      storageProvider: 'dropbox',
      storageFolderUrl: 'https://www.dropbox.com/home/tax-docs',
      typeformFormId: 'dummy-form-id',
      documents: [
        {
          id: 'doc-w2-1',
          fileName: 'W2_example copy.png',
          storageItemId: 'si-1',
          documentType: 'W-2',
          confidence: 1.0,
          taxYear: 2014,
          processingStatus: 'classified',
          classifiedAt: '2025-01-25T08:00:00Z',
          approved: null,
          approvedAt: null,
          override: null,
          archived: false,
          issues: [
            '[ERROR:wrong_year:2026:2014] Document is from 2014, expected 2026',
            '[ERROR:missing_field::] The employer name and EIN are missing from the W-2 for tax year 2026',
            '[ERROR:missing_field::] Employee SSN is not visible or illegible',
          ],
          checks: [
            {
              original: '[ERROR:wrong_year:2026:2014] Document is from 2014, expected 2026',
              friendlyMessage: 'Incorrect Year',
              suggestedAction: 'Request the client to provide a clearer copy of the W-2 showing the employer name and EIN.',
              severity: 'error',
            },
            {
              original: '[ERROR:missing_field::] The employer name and EIN are missing',
              friendlyMessage: 'Missing Wages',
              suggestedAction: 'Ask client for corrected W-2 with wages visible',
              severity: 'error',
            },
            {
              original: '[ERROR:missing_field::] Employee SSN is not visible',
              friendlyMessage: 'Missing Social Security #',
              suggestedAction: 'Ask client for W-2 showing SSN',
              severity: 'error',
            },
          ],
        },
        {
          id: 'doc-1099-1',
          fileName: 'f1099msc.pdf',
          storageItemId: 'si-2',
          documentType: '1099-MISC',
          confidence: 0.85,
          taxYear: 2026,
          processingStatus: 'classified',
          classifiedAt: '2025-01-25T08:00:00Z',
          approved: null,
          approvedAt: null,
          override: null,
          archived: false,
          issues: [
            '[WARNING:low_confidence::] Classification confidence below 90%',
          ],
          checks: [
            {
              original: '[WARNING:low_confidence::] Classification confidence below 90%',
              friendlyMessage: 'Needs Review',
              suggestedAction: 'Verify document classification is correct',
              severity: 'warning',
            },
          ],
        },
        {
          id: 'doc-1099-2',
          fileName: '1099int_2026.pdf',
          storageItemId: 'si-3',
          documentType: '1099-INT',
          confidence: 0.95,
          taxYear: 2026,
          processingStatus: 'classified',
          classifiedAt: '2025-01-25T08:00:00Z',
          approved: true,
          approvedAt: '2025-01-25T09:00:00Z',
          override: null,
          archived: false,
          issues: [],
          checks: null,
        },
        {
          id: 'doc-1099nec-1',
          fileName: '1099nec_2026.pdf',
          storageItemId: 'si-4',
          documentType: '1099-NEC',
          confidence: 0.92,
          taxYear: 2026,
          processingStatus: 'classified',
          classifiedAt: '2025-01-25T08:00:00Z',
          approved: true,
          approvedAt: '2025-01-25T09:00:00Z',
          override: null,
          archived: false,
          issues: [],
          checks: null,
        },
      ],
      checklist: [
        {
          id: 'cl-1',
          title: 'W-2 from Employer',
          why: 'Required for reporting wage income',
          priority: 'high',
          status: 'received',
          documentIds: ['doc-w2-1'],
        },
        {
          id: 'cl-2',
          title: '1099-MISC',
          why: 'Required for miscellaneous income',
          priority: 'medium',
          status: 'complete',
          documentIds: ['doc-1099-1'],
        },
        {
          id: 'cl-3',
          title: '1099-INT',
          why: 'Required for interest income',
          priority: 'medium',
          status: 'complete',
          documentIds: ['doc-1099-2'],
        },
        {
          id: 'cl-4',
          title: '1099-NEC',
          why: 'Required for non-employee compensation',
          priority: 'low',
          status: 'complete',
          documentIds: ['doc-1099nec-1'],
        },
      ],
      reconciliation: {
        completionPercentage: 50,
        itemStatuses: [
          { itemId: 'cl-1', status: 'received', documentIds: ['doc-w2-1'] },
          { itemId: 'cl-2', status: 'complete', documentIds: ['doc-1099-1'] },
          { itemId: 'cl-3', status: 'complete', documentIds: ['doc-1099-2'] },
          { itemId: 'cl-4', status: 'complete', documentIds: ['doc-1099nec-1'] },
        ],
        issues: ['W-2 has critical issues'],
        ranAt: '2025-01-25T10:00:00Z',
      },
    },
  })

  console.log('Creating engagement 3: Sally Pateck')
  await prisma.engagement.create({
    data: {
      clientName: 'Sally Pateck',
      clientEmail: 'spateck@gmail.com',
      taxYear: 2026,
      status: 'COLLECTING',
      storageProvider: 'dropbox',
      storageFolderUrl: 'https://www.dropbox.com/home/tax-docs',
      typeformFormId: 'dummy-form-id',
      reconciliation: {
        completionPercentage: 50,
        itemStatuses: [],
        issues: [],
        ranAt: '2025-01-25T10:00:00Z',
      },
    },
  })

  console.log('Creating engagement 4: Jill Roberts')
  await prisma.engagement.create({
    data: {
      clientName: 'Jill Roberts',
      clientEmail: 'jroberts@gmail.com',
      taxYear: 2026,
      status: 'READY',
      storageProvider: 'dropbox',
      storageFolderUrl: 'https://www.dropbox.com/home/tax-docs',
      typeformFormId: 'dummy-form-id',
      reconciliation: {
        completionPercentage: 100,
        itemStatuses: [],
        issues: [],
        ranAt: '2025-01-25T10:00:00Z',
      },
    },
  })

  console.log('Creating engagement 5: Ross Cabot')
  await prisma.engagement.create({
    data: {
      clientName: 'Ross Cabot',
      clientEmail: 'rcabot@gmail.com',
      taxYear: 2026,
      status: 'COLLECTING',
      storageProvider: 'dropbox',
      storageFolderUrl: 'https://www.dropbox.com/home/tax-docs',
      typeformFormId: 'dummy-form-id',
      reconciliation: {
        completionPercentage: 10,
        itemStatuses: [],
        issues: [],
        ranAt: '2025-01-25T10:00:00Z',
      },
    },
  })

  console.log('Creating engagement 6: Tom Hanson (second)')
  await prisma.engagement.create({
    data: {
      clientName: 'Tom Hanson',
      clientEmail: 'thanson@gmail.com',
      taxYear: 2026,
      status: 'READY',
      storageProvider: 'dropbox',
      storageFolderUrl: 'https://www.dropbox.com/home/tax-docs',
      typeformFormId: 'dummy-form-id',
      reconciliation: {
        completionPercentage: 100,
        itemStatuses: [],
        issues: [],
        ranAt: '2025-01-25T10:00:00Z',
      },
    },
  })

  console.log('Seeding complete! Created 6 engagements.')
}

main()
  .catch((e) => {
    console.error('Seed failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
