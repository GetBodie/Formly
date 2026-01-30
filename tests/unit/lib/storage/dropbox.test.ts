import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DocumentTooLargeError } from '@/lib/storage/types'

// Create mock dropbox instance that we can control
const mockFilesListFolder = vi.fn()
const mockFilesListFolderContinue = vi.fn()
const mockFilesGetMetadata = vi.fn()
const mockFilesDownload = vi.fn()
const mockSharingGetSharedLinkMetadata = vi.fn()

// Mock dropbox SDK
vi.mock('dropbox', () => {
  // Create a mock class for Dropbox
  const MockDropbox = vi.fn().mockImplementation(function() {
    return {
      filesListFolder: mockFilesListFolder,
      filesListFolderContinue: mockFilesListFolderContinue,
      filesGetMetadata: mockFilesGetMetadata,
      filesDownload: mockFilesDownload,
      sharingGetSharedLinkMetadata: mockSharingGetSharedLinkMetadata,
    }
  })

  return {
    Dropbox: MockDropbox,
  }
})

// Import after mocks are set up
import { dropboxClient } from '@/lib/storage/dropbox'

describe('dropboxClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.DROPBOX_ACCESS_TOKEN = 'test-token'
    process.env.DROPBOX_APP_KEY = 'test-app-key'
    process.env.DROPBOX_APP_SECRET = 'test-app-secret'
  })

  describe('syncFolder', () => {
    it('lists files on initial sync', async () => {
      mockFilesListFolder.mockResolvedValue({
        result: {
          entries: [
            { '.tag': 'file', id: 'id:file1', name: 'w2.pdf' },
            { '.tag': 'file', id: 'id:file2', name: '1099.pdf' },
            { '.tag': 'folder', id: 'id:folder1', name: 'subfolder' }, // Should be filtered
          ],
          cursor: 'cursor123',
          has_more: false,
        },
      })

      const result = await dropboxClient.syncFolder('/TaxDocs', null)

      expect(result.files).toHaveLength(2)
      expect(result.files[0]).toEqual({
        id: 'id:file1',
        name: 'w2.pdf',
        mimeType: 'application/pdf',
      })
      expect(result.nextPageToken).toBe('cursor123')
      expect(mockFilesListFolder).toHaveBeenCalledWith({
        path: '/TaxDocs',
        recursive: false,
      })
    })

    it('uses root path for "root" folder ID', async () => {
      mockFilesListFolder.mockResolvedValue({
        result: { entries: [], cursor: 'cursor', has_more: false },
      })

      await dropboxClient.syncFolder('root', null)

      expect(mockFilesListFolder).toHaveBeenCalledWith({
        path: '',
        recursive: false,
      })
    })

    it('continues from cursor when page token provided', async () => {
      mockFilesListFolderContinue.mockResolvedValue({
        result: {
          entries: [
            { '.tag': 'file', id: 'id:file3', name: 'new.pdf' },
            { '.tag': 'deleted', name: 'old.pdf' },
          ],
          cursor: 'cursor456',
          has_more: false,
        },
      })

      const result = await dropboxClient.syncFolder('/TaxDocs', 'cursor123')

      expect(result.files).toHaveLength(2)
      expect(result.files[1].deleted).toBe(true)
      expect(result.nextPageToken).toBe('cursor456')
      expect(mockFilesListFolderContinue).toHaveBeenCalledWith({ cursor: 'cursor123' })
    })
  })

  describe('downloadFile', () => {
    it('downloads file successfully', async () => {
      const fileContent = Buffer.from('PDF content')

      mockFilesGetMetadata.mockResolvedValue({
        result: { '.tag': 'file', name: 'document.pdf', size: 1024 },
      })

      mockFilesDownload.mockResolvedValue({
        result: { fileBinary: fileContent },
      })

      const result = await dropboxClient.downloadFile('id:file123')

      expect(result.fileName).toBe('document.pdf')
      expect(result.size).toBe(1024)
      expect(result.mimeType).toBe('application/pdf')
      expect(result.buffer).toEqual(fileContent)
    })

    it('throws error for folder', async () => {
      mockFilesGetMetadata.mockResolvedValue({
        result: { '.tag': 'folder', name: 'subfolder' },
      })

      await expect(dropboxClient.downloadFile('id:folder123')).rejects.toThrow('Not a file')
    })

    it('throws DocumentTooLargeError for files over 25MB', async () => {
      mockFilesGetMetadata.mockResolvedValue({
        result: { '.tag': 'file', name: 'large.zip', size: 30000000 },
      })

      await expect(dropboxClient.downloadFile('id:file123')).rejects.toThrow(DocumentTooLargeError)
    })
  })

  describe('resolveUrl', () => {
    it('resolves shared folder link', async () => {
      mockSharingGetSharedLinkMetadata.mockResolvedValue({
        result: { '.tag': 'folder', path_lower: '/shared/taxdocs' },
      })

      const result = await dropboxClient.resolveUrl('https://www.dropbox.com/sh/abc123/xyz?dl=0')

      expect(result).toEqual({ folderId: '/shared/taxdocs' })
    })

    it('resolves scl folder link', async () => {
      mockSharingGetSharedLinkMetadata.mockResolvedValue({
        result: { '.tag': 'folder', path_lower: '/my/folder' },
      })

      const result = await dropboxClient.resolveUrl('https://www.dropbox.com/scl/fo/abc123/xyz')

      expect(result).toEqual({ folderId: '/my/folder' })
    })

    it('resolves direct path URL', async () => {
      mockFilesGetMetadata.mockResolvedValue({
        result: { '.tag': 'folder' },
      })

      const result = await dropboxClient.resolveUrl('https://dropbox.com/home/TaxDocuments/2024')

      expect(result).toEqual({ folderId: '/TaxDocuments/2024' })
    })

    it('returns null for invalid shared link', async () => {
      mockSharingGetSharedLinkMetadata.mockRejectedValue(new Error('Invalid link'))

      const result = await dropboxClient.resolveUrl('https://www.dropbox.com/sh/invalid/link')

      expect(result).toBe(null)
    })

    it('returns null for non-existent path', async () => {
      mockFilesGetMetadata.mockRejectedValue(new Error('Path not found'))

      const result = await dropboxClient.resolveUrl('https://dropbox.com/home/NonExistent')

      expect(result).toBe(null)
    })

    it('returns null for non-Dropbox URL', async () => {
      const result = await dropboxClient.resolveUrl('https://example.com/folder')

      expect(result).toBe(null)
    })
  })

  describe('getMimeType', () => {
    it('maps common file extensions correctly', async () => {
      mockFilesListFolder.mockResolvedValue({
        result: {
          entries: [
            { '.tag': 'file', id: 'id:1', name: 'doc.pdf' },
            { '.tag': 'file', id: 'id:2', name: 'photo.jpg' },
            { '.tag': 'file', id: 'id:3', name: 'image.png' },
            { '.tag': 'file', id: 'id:4', name: 'data.xlsx' },
            { '.tag': 'file', id: 'id:5', name: 'unknown.xyz' },
          ],
          cursor: 'cursor',
          has_more: false,
        },
      })

      const result = await dropboxClient.syncFolder('/test', null)

      expect(result.files[0].mimeType).toBe('application/pdf')
      expect(result.files[1].mimeType).toBe('image/jpeg')
      expect(result.files[2].mimeType).toBe('image/png')
      expect(result.files[3].mimeType).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      expect(result.files[4].mimeType).toBe('application/octet-stream')
    })
  })
})
