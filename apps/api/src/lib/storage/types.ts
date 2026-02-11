/**
 * Storage provider abstraction for SharePoint and Google Drive
 */

export type StorageProvider = 'sharepoint' | 'google-drive' | 'dropbox'

export interface StorageFile {
  id: string
  name: string
  mimeType: string
  deleted?: boolean
}

export interface SyncResult {
  files: StorageFile[]
  nextPageToken: string | null
}

export interface DownloadResult {
  buffer: Buffer
  mimeType: string
  fileName: string
  size: number
  presignedUrl?: string  // Direct download URL if available (for OCR)
}

export interface FolderInfo {
  folderId: string
  driveId?: string // SharePoint only
}

export interface SyncOptions {
  driveId?: string        // SharePoint only
  sharedLinkUrl?: string  // Dropbox shared folder URL
  fileName?: string       // For constructing path from legacy file IDs
}

export interface StorageClient {
  /**
   * Sync folder contents, returning new/changed files since last sync
   */
  syncFolder(folderId: string, pageToken: string | null, options?: SyncOptions): Promise<SyncResult>

  /**
   * Download a file by ID
   */
  downloadFile(fileId: string, options?: SyncOptions): Promise<DownloadResult>

  /**
   * Resolve a shared URL to folder info
   */
  resolveUrl(url: string): Promise<FolderInfo | null>
}

export class DocumentTooLargeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DocumentTooLargeError'
  }
}

// Maximum file size: 25MB
export const MAX_FILE_SIZE = 25 * 1024 * 1024
