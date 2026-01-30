import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DocumentTooLargeError } from '@/lib/storage/types'

// Create mock drive instance that we can control
const mockFilesGet = vi.fn()
const mockFilesList = vi.fn()
const mockChangesList = vi.fn()
const mockChangesGetStartPageToken = vi.fn()

// Mock googleapis before importing the client
vi.mock('googleapis', () => {
  // Create a mock class for GoogleAuth
  const MockGoogleAuth = vi.fn().mockImplementation(function() {
    return {}
  })

  return {
    google: {
      auth: {
        GoogleAuth: MockGoogleAuth,
      },
      drive: vi.fn(() => ({
        files: {
          list: mockFilesList,
          get: mockFilesGet,
        },
        changes: {
          list: mockChangesList,
          getStartPageToken: mockChangesGetStartPageToken,
        },
      })),
    },
  }
})

// Import after mocks are set up
import { googleDriveClient } from '@/lib/storage/google-drive'

describe('googleDriveClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'test@project.iam.gserviceaccount.com'
    process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----'
  })

  describe('syncFolder', () => {
    it('lists files on initial sync (no page token)', async () => {
      mockFilesList.mockResolvedValue({
        data: {
          files: [
            { id: 'file1', name: 'w2.pdf', mimeType: 'application/pdf' },
            { id: 'file2', name: '1099.pdf', mimeType: 'application/pdf' },
          ],
          nextPageToken: undefined,
        },
      })

      mockChangesGetStartPageToken.mockResolvedValue({
        data: { startPageToken: 'token123' },
      })

      const result = await googleDriveClient.syncFolder('folder123', null)

      expect(result.files).toHaveLength(2)
      expect(result.files[0]).toEqual({
        id: 'file1',
        name: 'w2.pdf',
        mimeType: 'application/pdf',
      })
      expect(result.nextPageToken).toBe('token123')
      expect(mockFilesList).toHaveBeenCalledWith({
        q: "'folder123' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'",
        fields: 'nextPageToken, files(id, name, mimeType)',
        pageSize: 100,
      })
    })

    it('uses changes API when page token provided', async () => {
      mockChangesList.mockResolvedValue({
        data: {
          changes: [
            { fileId: 'file3', file: { id: 'file3', name: 'new.pdf', mimeType: 'application/pdf' } },
          ],
          newStartPageToken: 'token456',
        },
      })

      const result = await googleDriveClient.syncFolder('folder123', 'token123')

      expect(result.files).toHaveLength(1)
      expect(result.nextPageToken).toBe('token456')
      expect(mockChangesList).toHaveBeenCalledWith({
        pageToken: 'token123',
        spaces: 'drive',
        fields: 'nextPageToken, newStartPageToken, changes(fileId, removed, file(id, name, mimeType, trashed))',
      })
    })

    it('marks deleted files appropriately', async () => {
      mockChangesList.mockResolvedValue({
        data: {
          changes: [
            { fileId: 'file1', removed: true, file: { name: 'deleted.pdf' } },
            { fileId: 'file2', file: { id: 'file2', name: 'active.pdf', mimeType: 'application/pdf', trashed: false } },
          ],
          newStartPageToken: 'token789',
        },
      })

      const result = await googleDriveClient.syncFolder('folder123', 'token123')

      const deletedFile = result.files.find(f => f.id === 'file1')
      const activeFile = result.files.find(f => f.id === 'file2')

      expect(deletedFile?.deleted).toBe(true)
      expect(activeFile?.deleted).toBe(false)
    })
  })

  describe('downloadFile', () => {
    it('downloads file successfully', async () => {
      const fileContent = Buffer.from('PDF content')

      mockFilesGet
        .mockResolvedValueOnce({
          data: { name: 'document.pdf', size: '1024', mimeType: 'application/pdf' },
        })
        .mockResolvedValueOnce({
          data: fileContent,
        })

      const result = await googleDriveClient.downloadFile('file123')

      expect(result.fileName).toBe('document.pdf')
      expect(result.size).toBe(1024)
      expect(result.mimeType).toBe('application/pdf')
      expect(result.buffer).toEqual(fileContent)
    })

    it('throws DocumentTooLargeError for files over 25MB', async () => {
      mockFilesGet.mockResolvedValueOnce({
        data: { name: 'large.pdf', size: '30000000', mimeType: 'application/pdf' },
      })

      await expect(googleDriveClient.downloadFile('file123')).rejects.toThrow(DocumentTooLargeError)
    })
  })

  describe('resolveUrl', () => {
    it('extracts folder ID from standard URL', async () => {
      mockFilesGet.mockResolvedValue({ data: { id: 'abc123xyz' } })

      const result = await googleDriveClient.resolveUrl('https://drive.google.com/drive/folders/abc123xyz')

      expect(result).toEqual({ folderId: 'abc123xyz' })
    })

    it('extracts folder ID from URL with user path', async () => {
      mockFilesGet.mockResolvedValue({ data: { id: 'abc123xyz' } })

      const result = await googleDriveClient.resolveUrl('https://drive.google.com/drive/u/0/folders/abc123xyz')

      expect(result).toEqual({ folderId: 'abc123xyz' })
    })

    it('returns null for invalid URL', async () => {
      const result = await googleDriveClient.resolveUrl('https://example.com/not-a-drive-url')

      expect(result).toBe(null)
    })

    it('returns null when folder access denied', async () => {
      mockFilesGet.mockRejectedValue(new Error('Access denied'))

      const result = await googleDriveClient.resolveUrl('https://drive.google.com/drive/folders/private123')

      expect(result).toBe(null)
    })
  })
})
