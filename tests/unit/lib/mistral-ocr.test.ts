import { describe, it, expect, vi, beforeEach } from 'vitest'

// Use vi.hoisted to ensure mock is available before module import
const mocks = vi.hoisted(() => ({
  ocrProcess: vi.fn(),
}))

vi.mock('@mistralai/mistralai', () => ({
  Mistral: class MockMistral {
    ocr = { process: mocks.ocrProcess }
  },
}))

const mockOcrProcess = mocks.ocrProcess

// Helper functions
function mockOcrSuccess(pages: Array<{ markdown: string; tables?: Array<{ id: string; content: string; format: string }> }>) {
  const fullPages = pages.map((p, i) => ({
    index: i,
    markdown: p.markdown,
    tables: p.tables ?? [],
  }))

  mockOcrProcess.mockResolvedValue({
    pages: fullPages,
    model: 'mistral-ocr-latest',
  })
}

function mockOcrFailure(message: string, statusCode?: number) {
  const error = new Error(message) as Error & { status?: number }
  if (statusCode) {
    error.status = statusCode
  }
  mockOcrProcess.mockRejectedValue(error)
}

import { extractDocument, extractDocumentWithFallback } from '@/lib/mistral-ocr'

describe('mistral-ocr', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('extractDocument', () => {
    it('should call Mistral OCR API with correct parameters', async () => {
      mockOcrSuccess([{ markdown: 'test content' }])

      await extractDocument({ documentUrl: 'https://example.com/doc.pdf' })

      expect(mockOcrProcess).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'mistral-ocr-latest',
          document: { type: 'document_url', documentUrl: 'https://example.com/doc.pdf' },
          includeImageBase64: false,
        })
      )
    })

    it('should return normalized OCR result', async () => {
      mockOcrSuccess([
        { markdown: 'Page 1 content', tables: [{ id: 'tbl-1', content: '<table></table>', format: 'html' }] },
        { markdown: 'Page 2 content', tables: [] },
      ])

      const result = await extractDocument({ documentUrl: 'https://example.com/doc.pdf' })

      expect(result.markdown).toContain('Page 1 content')
      expect(result.markdown).toContain('Page 2 content')
      expect(result.pages).toHaveLength(2)
      expect(result.tables).toHaveLength(1)
    })

    it('should use HTML table format by default', async () => {
      mockOcrSuccess([{ markdown: 'test' }])

      await extractDocument({ documentUrl: 'https://example.com/doc.pdf' })

      expect(mockOcrProcess).toHaveBeenCalledWith(
        expect.objectContaining({
          tableFormat: 'html',
        })
      )
    })

    it('should allow custom table format', async () => {
      mockOcrSuccess([{ markdown: 'test' }])

      await extractDocument({ documentUrl: 'https://example.com/doc.pdf', tableFormat: 'markdown' })

      expect(mockOcrProcess).toHaveBeenCalledWith(
        expect.objectContaining({
          tableFormat: 'markdown',
        })
      )
    })

    it('should retry on 429 rate limit error', async () => {
      const rateLimitError = new Error('Rate limited') as Error & { status: number }
      rateLimitError.status = 429

      mockOcrProcess
        .mockRejectedValueOnce(rateLimitError)
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce({
          pages: [{ markdown: 'success', tables: [] }],
          model: 'mistral-ocr-latest',
        })

      const result = await extractDocument({ documentUrl: 'url' })

      expect(mockOcrProcess).toHaveBeenCalledTimes(3)
      expect(result.markdown).toBe('success')
    })

    it('should retry on 500 server error', async () => {
      const serverError = new Error('Server error') as Error & { status: number }
      serverError.status = 500

      mockOcrProcess
        .mockRejectedValueOnce(serverError)
        .mockResolvedValueOnce({
          pages: [{ markdown: 'recovered', tables: [] }],
          model: 'mistral-ocr-latest',
        })

      const result = await extractDocument({ documentUrl: 'url' })

      expect(mockOcrProcess).toHaveBeenCalledTimes(2)
      expect(result.markdown).toBe('recovered')
    })

    it('should not retry on 400 client error', async () => {
      const clientError = new Error('Bad request') as Error & { status: number }
      clientError.status = 400

      mockOcrProcess.mockRejectedValue(clientError)

      await expect(extractDocument({ documentUrl: 'url' })).rejects.toThrow('Bad request')
      expect(mockOcrProcess).toHaveBeenCalledTimes(1)
    })

    it('should not retry on 413 payload too large', async () => {
      const payloadError = new Error('Payload too large') as Error & { status: number }
      payloadError.status = 413

      mockOcrProcess.mockRejectedValue(payloadError)

      await expect(extractDocument({ documentUrl: 'url' })).rejects.toThrow('Payload too large')
      expect(mockOcrProcess).toHaveBeenCalledTimes(1)
    })

    it('should fail after max retries', async () => {
      const serverError = new Error('Server error') as Error & { status: number }
      serverError.status = 500

      mockOcrProcess.mockRejectedValue(serverError)

      await expect(extractDocument({ documentUrl: 'url' })).rejects.toThrow('Server error')
      expect(mockOcrProcess).toHaveBeenCalledTimes(3) // Default max retries
    })
  })

  describe('extractDocumentWithFallback', () => {
    it('should return OCR result on success', async () => {
      mockOcrSuccess([{ markdown: 'OCR extracted text' }])

      const result = await extractDocumentWithFallback('url', 'fallback text')

      expect(result.markdown).toBe('OCR extracted text')
    })

    it('should return fallback on OCR failure', async () => {
      mockOcrFailure('OCR failed')

      const result = await extractDocumentWithFallback('url', 'fallback text')

      expect(result.markdown).toBe('fallback text')
      expect(result.pages).toHaveLength(1)
      expect(result.pages[0].markdown).toBe('fallback text')
      expect(result.tables).toHaveLength(0)
    })

    it('should return fallback even after retries exhaust', async () => {
      const serverError = new Error('Persistent failure') as Error & { status: number }
      serverError.status = 500

      mockOcrProcess.mockRejectedValue(serverError)

      const result = await extractDocumentWithFallback('url', 'fallback content')

      expect(result.markdown).toBe('fallback content')
    })
  })
})
