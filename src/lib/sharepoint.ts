/**
 * @deprecated Use `@/lib/storage` instead
 * This file is kept for backwards compatibility
 */

import { sharePointClient, DocumentTooLargeError, type DownloadResult } from './storage'

export { DocumentTooLargeError }
export type { DownloadResult }

export async function syncFolder(driveId: string, folderId: string, deltaLink: string | null) {
  const result = await sharePointClient.syncFolder(folderId, deltaLink, driveId)
  return {
    items: result.files.map(f => ({
      id: f.id,
      name: f.name,
      file: { mimeType: f.mimeType },
      deleted: f.deleted,
    })),
    newDeltaLink: result.nextPageToken,
  }
}

export async function downloadFile(driveId: string, itemId: string): Promise<DownloadResult & { presignedUrl: string }> {
  const result = await sharePointClient.downloadFile(itemId, driveId)
  return {
    ...result,
    presignedUrl: '', // No longer exposed in new API
  }
}

export async function resolveSharePointUrl(url: string) {
  const result = await sharePointClient.resolveUrl(url)
  if (!result) return null
  return {
    driveId: result.driveId!,
    folderId: result.folderId,
  }
}
