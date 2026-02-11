import { prisma } from './prisma.js'
import { getStorageClient, type StorageProvider } from './storage/index.js'
import { dispatch } from './agents/dispatcher.js'

export async function pollEngagement(engagement: {
  id: string
  storageProvider: string
  storageFolderId: string | null
  storageFolderUrl: string | null
  storageDriveId: string | null
  storagePageToken: string | null
  checklist: unknown
}) {
  const provider = (engagement.storageProvider || 'dropbox') as StorageProvider
  const folderId = engagement.storageFolderId
  const driveId = engagement.storageDriveId
  const pageToken = engagement.storagePageToken
  const folderUrl = engagement.storageFolderUrl

  // For Dropbox shared folders, we can sync using the URL even without folderId
  if (provider !== 'dropbox' && !folderId) return
  if (provider === 'dropbox' && !folderId && !folderUrl) return

  // Google Drive may require driveId for shared drives
  if (provider === 'google-drive' && !driveId && !folderId) return

  try {
    const client = getStorageClient(provider)
    const { files, nextPageToken } = await client.syncFolder(
      folderId || '',
      pageToken,
      { driveId: driveId || undefined, sharedLinkUrl: folderUrl || undefined }
    )

    // Query existing storageItemIds from Document table
    const existingIds = new Set(
      (await prisma.document.findMany({
        where: { engagementId: engagement.id },
        select: { storageItemId: true }
      })).map(d => d.storageItemId)
    )

    // Process new files
    const newFiles = files.filter(file => !file.deleted && !existingIds.has(file.id))

    if (newFiles.length === 0) {
      await prisma.engagement.update({
        where: { id: engagement.id },
        data: { storagePageToken: nextPageToken }
      })
      return
    }

    // Create document rows for new files
    await prisma.document.createMany({
      data: newFiles.map(file => ({
        engagementId: engagement.id,
        fileName: file.name,
        storageItemId: file.id,
      }))
    })

    // Update page token and status
    await prisma.engagement.update({
      where: { id: engagement.id },
      data: {
        storagePageToken: nextPageToken,
        status: 'COLLECTING'
      }
    })

    // Fetch created docs to get their IDs for dispatch
    const createdDocs = await prisma.document.findMany({
      where: {
        engagementId: engagement.id,
        storageItemId: { in: newFiles.map(f => f.id) }
      }
    })

    // Dispatch document_uploaded events in parallel batches (5 concurrent)
    const BATCH_SIZE = 5
    for (let i = 0; i < createdDocs.length; i += BATCH_SIZE) {
      const batch = createdDocs.slice(i, i + BATCH_SIZE)
      await Promise.allSettled(
        batch.map(doc =>
          dispatch({
            type: 'document_uploaded',
            engagementId: engagement.id,
            documentId: doc.id,
            storageItemId: doc.storageItemId,
            fileName: doc.fileName
          })
        )
      )
    }

    console.log(`[POLL] ${engagement.id}: Dispatched ${newFiles.length} documents (${provider})`)
  } catch (error) {
    console.error(`[POLL] Error processing engagement ${engagement.id}:`, error)
  }
}
