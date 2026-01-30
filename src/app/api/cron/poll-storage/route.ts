import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { prisma } from '@/lib/prisma'
import { getStorageClient, type StorageProvider } from '@/lib/storage'
import { dispatch } from '@/lib/agents/dispatcher'
import type { Document } from '@/types'

export async function GET(request: NextRequest) {
  // Verify cron secret
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const engagements = await prisma.engagement.findMany({
    where: { status: { in: ['INTAKE_DONE', 'COLLECTING'] } },
  })

  // Process all in background
  waitUntil(Promise.all(engagements.map(pollEngagement)))

  return NextResponse.json({ queued: engagements.length })
}

async function pollEngagement(engagement: {
  id: string
  storageProvider: string
  storageFolderId: string | null
  storageDriveId: string | null
  storagePageToken: string | null
  // Legacy fields
  sharepointDriveId: string | null
  sharepointFolderId: string | null
  deltaLink: string | null
  checklist: unknown
  documents: unknown
}) {
  // Support both new and legacy field names
  const provider = (engagement.storageProvider || 'sharepoint') as StorageProvider
  const folderId = engagement.storageFolderId || engagement.sharepointFolderId
  const driveId = engagement.storageDriveId || engagement.sharepointDriveId
  const pageToken = engagement.storagePageToken || engagement.deltaLink

  if (!folderId) return

  // SharePoint requires driveId
  if (provider === 'sharepoint' && !driveId) return

  try {
    const client = getStorageClient(provider)
    const { files, nextPageToken } = await client.syncFolder(folderId, pageToken, driveId || undefined)

    const existingDocs = (engagement.documents as Document[]) || []
    const existingIds = new Set(existingDocs.map(d => d.storageItemId || d.sharepointItemId))

    // Process new files
    const newFiles = files.filter(file => !file.deleted && !existingIds.has(file.id))

    if (newFiles.length === 0) {
      // Just update page token if no new files
      await prisma.engagement.update({
        where: { id: engagement.id },
        data: { storagePageToken: nextPageToken, deltaLink: nextPageToken }
      })
      return
    }

    // Add placeholder documents for new files
    for (const file of newFiles) {
      const newDoc: Document = {
        id: crypto.randomUUID(),
        fileName: file.name,
        storageItemId: file.id,
        sharepointItemId: file.id, // Keep for backwards compatibility
        documentType: 'PENDING',
        confidence: 0,
        taxYear: null,
        issues: [],
        classifiedAt: null,
      }

      existingDocs.push(newDoc)
    }

    // Update documents list and page token
    await prisma.engagement.update({
      where: { id: engagement.id },
      data: {
        storagePageToken: nextPageToken,
        deltaLink: nextPageToken, // Keep legacy field in sync
        documents: existingDocs,
        status: 'COLLECTING'
      }
    })

    // Dispatch document_uploaded events for each new file
    for (const file of newFiles) {
      const doc = existingDocs.find(d => d.storageItemId === file.id || d.sharepointItemId === file.id)
      if (!doc) continue

      await dispatch({
        type: 'document_uploaded',
        engagementId: engagement.id,
        documentId: doc.id,
        sharepointItemId: file.id, // Keep event shape for backwards compatibility
        fileName: file.name
      })
    }

    console.log(`[POLL] ${engagement.id}: Dispatched ${newFiles.length} documents (${provider})`)
  } catch (error) {
    console.error(`[POLL] Error processing engagement ${engagement.id}:`, error)
  }
}
