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

function mockW2Document() {
  mockOcrSuccess([
    {
      markdown: `
## Form W-2 Wage and Tax Statement 2024

**Employer Information**
- Employer: ABC Corporation
- EIN: 12-3456789
- Address: 123 Main St, Anytown, CA 90210

**Employee Information**
- Name: John Q. Taxpayer
- SSN: XXX-XX-1234
- Address: 456 Oak Ave, Somewhere, CA 90211

| Box | Description | Amount |
|-----|-------------|--------|
| 1 | Wages, tips, other compensation | $75,000.00 |
| 2 | Federal income tax withheld | $12,500.00 |
| 3 | Social security wages | $75,000.00 |
| 4 | Social security tax withheld | $4,650.00 |
| 5 | Medicare wages and tips | $75,000.00 |
| 6 | Medicare tax withheld | $1,087.50 |
      `.trim(),
      tables: [
        {
          id: 'tbl-1',
          content:
            '<table><tr><th>Box</th><th>Description</th><th>Amount</th></tr><tr><td>1</td><td>Wages</td><td>$75,000.00</td></tr></table>',
          format: 'html',
        },
      ],
    },
  ])
}

import {
  extractDocument,
  isSupportedFileType,
  UnsupportedFileTypeError,
} from '@/lib/document-extraction'

describe('document-extraction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('isSupportedFileType', () => {
    it('should accept PDF', () => {
      expect(isSupportedFileType('application/pdf')).toBe(true)
    })

    it('should accept JPEG', () => {
      expect(isSupportedFileType('image/jpeg')).toBe(true)
    })

    it('should accept PNG', () => {
      expect(isSupportedFileType('image/png')).toBe(true)
    })

    it('should accept HEIC', () => {
      expect(isSupportedFileType('image/heic')).toBe(true)
    })

    it('should accept HEIF', () => {
      expect(isSupportedFileType('image/heif')).toBe(true)
    })

    it('should accept DOCX', () => {
      expect(
        isSupportedFileType('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      ).toBe(true)
    })

    it('should accept XLSX', () => {
      expect(
        isSupportedFileType('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      ).toBe(true)
    })

    it('should reject text/plain', () => {
      expect(isSupportedFileType('text/plain')).toBe(false)
    })

    it('should reject application/zip', () => {
      expect(isSupportedFileType('application/zip')).toBe(false)
    })

    it('should reject application/json', () => {
      expect(isSupportedFileType('application/json')).toBe(false)
    })
  })

  describe('extractDocument', () => {
    it('should extract PDF via presigned URL', async () => {
      mockOcrSuccess([{ markdown: 'PDF content here' }])

      const result = await extractDocument(
        'https://presigned.url/doc.pdf',
        Buffer.from('fake pdf'),
        'application/pdf'
      )

      expect(result.markdown).toContain('PDF content here')
      expect(result.method).toBe('ocr')
      expect(mockOcrProcess).toHaveBeenCalledWith(
        expect.objectContaining({
          document: { type: 'document_url', documentUrl: 'https://presigned.url/doc.pdf' },
          tableFormat: 'html',
        })
      )
    })

    it('should extract JPEG image via base64', async () => {
      mockOcrSuccess([{ markdown: 'Image text' }])
      const imageBuffer = Buffer.from('fake image data')

      const result = await extractDocument('https://unused.url', imageBuffer, 'image/jpeg')

      expect(result.markdown).toContain('Image text')
      expect(mockOcrProcess).toHaveBeenCalledWith(
        expect.objectContaining({
          document: expect.objectContaining({
            documentUrl: expect.stringMatching(/^data:image\/jpeg;base64,/),
          }),
        })
      )
    })

    it('should extract PNG image via base64', async () => {
      mockOcrSuccess([{ markdown: 'PNG text' }])
      const imageBuffer = Buffer.from('fake png data')

      const result = await extractDocument('https://unused.url', imageBuffer, 'image/png')

      expect(result.markdown).toContain('PNG text')
      expect(mockOcrProcess).toHaveBeenCalledWith(
        expect.objectContaining({
          document: expect.objectContaining({
            documentUrl: expect.stringMatching(/^data:image\/png;base64,/),
          }),
        })
      )
    })

    it('should extract DOCX via base64', async () => {
      mockOcrSuccess([{ markdown: 'Word document content' }])
      const docxBuffer = Buffer.from('fake docx data')

      const result = await extractDocument(
        'https://unused.url',
        docxBuffer,
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      )

      expect(result.markdown).toContain('Word document content')
      expect(mockOcrProcess).toHaveBeenCalledWith(
        expect.objectContaining({
          document: expect.objectContaining({
            documentUrl: expect.stringMatching(
              /^data:application\/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,/
            ),
          }),
        })
      )
    })

    it('should extract XLSX via base64', async () => {
      mockOcrSuccess([{ markdown: 'Excel data' }])
      const xlsxBuffer = Buffer.from('fake xlsx data')

      const result = await extractDocument(
        'https://unused.url',
        xlsxBuffer,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      )

      expect(result.markdown).toContain('Excel data')
    })

    it('should handle multi-page documents', async () => {
      mockOcrSuccess([{ markdown: 'Page 1' }, { markdown: 'Page 2' }, { markdown: 'Page 3' }])

      const result = await extractDocument(
        'https://presigned.url/multi.pdf',
        Buffer.from('fake'),
        'application/pdf'
      )

      expect(result.pages).toHaveLength(3)
      expect(result.markdown).toContain('Page 1')
      expect(result.markdown).toContain('Page 2')
      expect(result.markdown).toContain('Page 3')
    })

    it('should throw UnsupportedFileTypeError for unsupported types', async () => {
      await expect(extractDocument('url', Buffer.from(''), 'text/plain')).rejects.toThrow(
        UnsupportedFileTypeError
      )
      await expect(extractDocument('url', Buffer.from(''), 'text/plain')).rejects.toThrow(
        'not supported'
      )
    })

    it('should extract W-2 with tables', async () => {
      mockW2Document()

      const result = await extractDocument(
        'https://presigned.url/w2.pdf',
        Buffer.from('fake'),
        'application/pdf'
      )

      expect(result.markdown).toContain('W-2')
      expect(result.markdown).toContain('EIN: 12-3456789')
      expect(result.tables.length).toBeGreaterThan(0)
      expect(result.confidence).toBeGreaterThan(0.8)
    })

    it('should calculate high confidence for documents with content and tables', async () => {
      mockOcrSuccess([
        {
          markdown: 'A'.repeat(200), // >100 chars
          tables: [{ id: 'tbl-1', content: '<table></table>', format: 'html' }],
        },
      ])

      const result = await extractDocument('url', Buffer.from(''), 'application/pdf')

      expect(result.confidence).toBe(0.95)
    })

    it('should calculate medium confidence for documents with content but no tables', async () => {
      mockOcrSuccess([
        {
          markdown: 'A'.repeat(200), // >100 chars
          tables: [],
        },
      ])

      const result = await extractDocument('url', Buffer.from(''), 'application/pdf')

      expect(result.confidence).toBe(0.85)
    })

    it('should calculate low confidence for documents with little content', async () => {
      mockOcrSuccess([
        {
          markdown: 'Short', // <100 chars
          tables: [],
        },
      ])

      const result = await extractDocument('url', Buffer.from(''), 'application/pdf')

      expect(result.confidence).toBe(0.6)
    })
  })
})
