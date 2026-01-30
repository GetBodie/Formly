import { describe, it, expect } from 'vitest'
import { detectProvider, getStorageClient } from '@/lib/storage'

describe('storage/index', () => {
  describe('detectProvider', () => {
    it('detects SharePoint URLs', () => {
      expect(detectProvider('https://company.sharepoint.com/sites/tax/folder')).toBe('sharepoint')
      expect(detectProvider('https://company-my.sharepoint.com/personal/user/Documents')).toBe('sharepoint')
    })

    it('detects OneDrive URLs as SharePoint', () => {
      expect(detectProvider('https://onedrive.com/personal/user/folder')).toBe('sharepoint')
      expect(detectProvider('https://1drv.ms/u/s!abc123')).toBe(null) // Short links not supported
    })

    it('detects Google Drive URLs', () => {
      expect(detectProvider('https://drive.google.com/drive/folders/abc123')).toBe('google-drive')
      expect(detectProvider('https://drive.google.com/drive/u/0/folders/abc123')).toBe('google-drive')
      expect(detectProvider('https://drive.google.com/folderview?id=abc123')).toBe('google-drive')
    })

    it('detects Dropbox URLs', () => {
      expect(detectProvider('https://www.dropbox.com/sh/abc123/xyz?dl=0')).toBe('dropbox')
      expect(detectProvider('https://www.dropbox.com/scl/fo/abc123/xyz')).toBe('dropbox')
      expect(detectProvider('https://dropbox.com/home/TaxDocuments')).toBe('dropbox')
    })

    it('returns null for unknown URLs', () => {
      expect(detectProvider('https://example.com/folder')).toBe(null)
      expect(detectProvider('https://box.com/folder/123')).toBe(null)
      expect(detectProvider('ftp://files.example.com')).toBe(null)
    })
  })

  describe('getStorageClient', () => {
    it('returns SharePoint client', () => {
      const client = getStorageClient('sharepoint')
      expect(client).toBeDefined()
      expect(client.syncFolder).toBeDefined()
      expect(client.downloadFile).toBeDefined()
      expect(client.resolveUrl).toBeDefined()
    })

    it('returns Google Drive client', () => {
      const client = getStorageClient('google-drive')
      expect(client).toBeDefined()
      expect(client.syncFolder).toBeDefined()
      expect(client.downloadFile).toBeDefined()
      expect(client.resolveUrl).toBeDefined()
    })

    it('returns Dropbox client', () => {
      const client = getStorageClient('dropbox')
      expect(client).toBeDefined()
      expect(client.syncFolder).toBeDefined()
      expect(client.downloadFile).toBeDefined()
      expect(client.resolveUrl).toBeDefined()
    })

    it('throws for unknown provider', () => {
      expect(() => getStorageClient('unknown' as never)).toThrow('Unknown storage provider')
    })
  })
})
