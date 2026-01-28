import { vi } from 'vitest'

/**
 * Mock Mistral OCR page structure (matches actual API)
 */
export interface MockOcrPage {
  index: number
  markdown: string
  tables: Array<{ id: string; content: string; format: string }>
  images: Array<{ id: string; base64?: string }>
  dimensions: { dpi: number; height: number; width: number }
}

/**
 * Mock Mistral OCR result (matches actual API)
 */
export interface MockOcrResult {
  pages: MockOcrPage[]
  model: string
  usageInfo: { pagesProcessed: number }
}

/**
 * Mock Mistral client
 */
export const mockMistral = {
  ocr: {
    process: vi.fn(),
  },
}

/**
 * Helper to mock successful OCR extraction
 */
export function mockOcrSuccess(pages: Partial<MockOcrPage>[] = [{ markdown: 'Test content' }]): void {
  const fullPages = pages.map((p, i) => ({
    index: p.index ?? i,
    markdown: p.markdown ?? '',
    tables: p.tables ?? [],
    images: p.images ?? [],
    dimensions: p.dimensions ?? { dpi: 300, height: 792, width: 612 },
  }))

  mockMistral.ocr.process.mockResolvedValue({
    pages: fullPages,
    model: 'mistral-ocr-latest',
    usageInfo: { pagesProcessed: fullPages.length },
  })
}

/**
 * Helper to mock multi-page documents
 */
export function mockMultiPageDocument(pageCount: number): void {
  const pages = Array.from({ length: pageCount }, (_, i) => ({
    index: i,
    markdown: `Page ${i + 1} content`,
    tables: [],
    images: [],
    dimensions: { dpi: 300, height: 792, width: 612 },
  }))

  mockMistral.ocr.process.mockResolvedValue({
    pages,
    model: 'mistral-ocr-latest',
    usageInfo: { pagesProcessed: pageCount },
  })
}

/**
 * Helper to mock W-2 document
 */
export function mockW2Document(): void {
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

/**
 * Helper to mock 1099-NEC document
 */
export function mock1099NECDocument(): void {
  mockOcrSuccess([
    {
      markdown: `
## Form 1099-NEC Nonemployee Compensation 2024

**Payer Information**
- Name: Freelance Corp
- TIN: 98-7654321

**Recipient Information**
- Name: Jane Contractor
- TIN: XXX-XX-5678

**Box 1 - Nonemployee compensation**: $45,000.00
      `.trim(),
      tables: [],
    },
  ])
}

/**
 * Helper to mock OCR failure
 */
export function mockOcrFailure(message: string, statusCode?: number): void {
  const error = new Error(message) as Error & { status?: number }
  if (statusCode) {
    error.status = statusCode
  }
  mockMistral.ocr.process.mockRejectedValue(error)
}

/**
 * Factory for vi.mock
 */
export function createMistralMock() {
  return {
    Mistral: vi.fn(() => mockMistral),
  }
}

/**
 * Mock for extractDocumentWithFallback function
 */
export const mockExtractDocumentWithFallback = vi.fn()

export function mockExtractSuccess(
  markdown: string,
  tables: Array<{ id: string; content: string; format: string }> = [],
  pages: Array<{ index: number; markdown: string; tables: Array<{ id: string; content: string; format: string }> }> = []
): void {
  mockExtractDocumentWithFallback.mockResolvedValue({
    markdown,
    tables,
    pages: pages.length > 0 ? pages : [{ index: 0, markdown, tables }],
  })
}

export function mockExtractFailure(message: string): void {
  mockExtractDocumentWithFallback.mockRejectedValue(new Error(message))
}
