import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Graph client
const mockGraphClient = {
  api: vi.fn(),
}

vi.mock('@microsoft/microsoft-graph-client', () => ({
  Client: {
    initWithMiddleware: vi.fn(() => mockGraphClient),
  },
}))

vi.mock('@azure/identity', () => ({
  ClientSecretCredential: vi.fn(),
}))

vi.mock('@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials/index.js', () => ({
  TokenCredentialAuthenticationProvider: vi.fn(),
}))

// Mock global fetch
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import { downloadFile, resolveSharePointUrl, DocumentTooLargeError } from '@/lib/sharepoint'

describe('sharepoint', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('downloadFile', () => {
    it('should return buffer, presigned URL, and mime type', async () => {
      const mockItem = {
        name: 'w2-2024.pdf',
        size: 1024,
        file: { mimeType: 'application/pdf' },
        '@microsoft.graph.downloadUrl': 'https://presigned.url/file',
      }

      mockGraphClient.api.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        get: vi.fn().mockResolvedValue(mockItem),
      })

      mockFetch.mockResolvedValue({
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(1024)),
      })

      const result = await downloadFile('drive-id', 'item-id')

      expect(result.presignedUrl).toBe('') // No longer exposed in new storage API
      expect(result.mimeType).toBe('application/pdf')
      expect(result.fileName).toBe('w2-2024.pdf')
      expect(result.size).toBe(1024)
      expect(result.buffer).toBeInstanceOf(Buffer)
    })

    it('should throw DocumentTooLargeError for files over 25MB', async () => {
      const mockItem = {
        name: 'huge.pdf',
        size: 30 * 1024 * 1024, // 30MB
        file: { mimeType: 'application/pdf' },
        '@microsoft.graph.downloadUrl': 'https://presigned.url/file',
      }

      mockGraphClient.api.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        get: vi.fn().mockResolvedValue(mockItem),
      })

      await expect(downloadFile('drive-id', 'item-id')).rejects.toThrow(DocumentTooLargeError)
      await expect(downloadFile('drive-id', 'item-id')).rejects.toThrow('exceeds')
    })

    it('should use default mime type if not provided', async () => {
      const mockItem = {
        name: 'unknown-file',
        size: 1024,
        file: null, // No file info
        '@microsoft.graph.downloadUrl': 'https://presigned.url/file',
      }

      mockGraphClient.api.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        get: vi.fn().mockResolvedValue(mockItem),
      })

      mockFetch.mockResolvedValue({
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(1024)),
      })

      const result = await downloadFile('drive-id', 'item-id')

      expect(result.mimeType).toBe('application/octet-stream')
    })

    it('should call Graph API with correct path and selectors', async () => {
      const mockItem = {
        name: 'test.pdf',
        size: 1024,
        file: { mimeType: 'application/pdf' },
        '@microsoft.graph.downloadUrl': 'https://presigned.url/file',
      }

      const mockSelect = vi.fn().mockReturnThis()
      const mockGet = vi.fn().mockResolvedValue(mockItem)

      mockGraphClient.api.mockReturnValue({
        select: mockSelect,
        get: mockGet,
      })

      mockFetch.mockResolvedValue({
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(1024)),
      })

      await downloadFile('drive-123', 'item-456')

      expect(mockGraphClient.api).toHaveBeenCalledWith('/drives/drive-123/items/item-456')
      expect(mockSelect).toHaveBeenCalledWith('name,size,file,@microsoft.graph.downloadUrl')
    })
  })

  describe('resolveSharePointUrl', () => {
    it('should extract drive and folder IDs from share URL', async () => {
      mockGraphClient.api.mockReturnValue({
        get: vi.fn().mockResolvedValue({
          parentReference: { driveId: 'drive-123' },
          id: 'folder-456',
        }),
      })

      const result = await resolveSharePointUrl('https://company.sharepoint.com/...')

      expect(result).toEqual({
        driveId: 'drive-123',
        folderId: 'folder-456',
      })
    })

    it('should return null for invalid URLs', async () => {
      mockGraphClient.api.mockReturnValue({
        get: vi.fn().mockRejectedValue(new Error('Not found')),
      })

      const result = await resolveSharePointUrl('invalid-url')

      expect(result).toBeNull()
    })

    it('should encode URL correctly for shares API', async () => {
      const testUrl = 'https://company.sharepoint.com/sites/test'

      mockGraphClient.api.mockReturnValue({
        get: vi.fn().mockResolvedValue({
          parentReference: { driveId: 'drive-123' },
          id: 'folder-456',
        }),
      })

      await resolveSharePointUrl(testUrl)

      const expectedEncoded = Buffer.from(testUrl).toString('base64')
      expect(mockGraphClient.api).toHaveBeenCalledWith(`/shares/u!${expectedEncoded}/driveItem`)
    })
  })
})
