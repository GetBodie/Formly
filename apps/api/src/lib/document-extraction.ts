import { extractDocument as mistralOCR, type OCRResult } from './mistral-ocr.js'
import OpenAI from 'openai'

const openai = new OpenAI()

// Custom error for unsupported file types
export class UnsupportedFileTypeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsupportedFileTypeError'
  }
}

export interface ExtractionResult {
  markdown: string
  tables: Array<{ id: string; content: string; format: string }>
  pages: Array<{ index: number; markdown: string }>
  confidence: number
  method: 'ocr' | 'text'
}

const SUPPORTED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/heif',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
])

export function isSupportedFileType(mimeType: string): boolean {
  return SUPPORTED_MIME_TYPES.has(mimeType)
}

export async function extractDocument(
  presignedUrl: string,
  buffer: Buffer,
  mimeType: string
): Promise<ExtractionResult> {
  if (!isSupportedFileType(mimeType)) {
    throw new UnsupportedFileTypeError(
      `File type ${mimeType} is not supported. ` +
        `Supported types: PDF, JPG, PNG, HEIC, DOCX, XLSX`
    )
  }

  // Route by file type
  if (mimeType === 'application/pdf') {
    return extractPDF(presignedUrl)
  }

  if (mimeType.startsWith('image/')) {
    return extractImage(buffer, mimeType)
  }

  // Office documents - send as base64
  return extractOfficeDocument(buffer, mimeType)
}

async function extractPDF(presignedUrl: string): Promise<ExtractionResult> {
  const result = await mistralOCR({
    documentUrl: presignedUrl,
    tableFormat: 'html',
  })

  return normalizeOCRResult(result)
}

async function extractImage(buffer: Buffer, mimeType: string): Promise<ExtractionResult> {
  let imageBuffer = buffer
  let finalMimeType = mimeType

  // Convert HEIC to JPEG if needed
  if (mimeType === 'image/heic' || mimeType === 'image/heif') {
    try {
      // Dynamic import of sharp for optional HEIC conversion
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sharp = (await import('sharp' as any)).default as {
        (input: Buffer): { jpeg(): { toBuffer(): Promise<Buffer> } }
      }
      imageBuffer = await sharp(buffer).jpeg().toBuffer()
      finalMimeType = 'image/jpeg'
    } catch {
      console.warn('[EXTRACTION] HEIC conversion not available, trying direct extraction')
    }
  }

  // Use OpenAI Vision for images (Mistral OCR only supports https URLs for images)
  const base64 = imageBuffer.toString('base64')
  const dataUri = `data:${finalMimeType};base64,${base64}`

  console.log(`[EXTRACTION] Using OpenAI Vision for image (${finalMimeType})`)

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `You are a document OCR system. Extract ALL text content from this document image.
Preserve the document structure as much as possible using markdown formatting.
For tax documents (W-2, 1099, etc.), extract all box numbers and their values.
For tables, format them in markdown.
Be thorough - extract every piece of visible text.`,
      },
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: {
              url: dataUri,
              detail: 'high',
            },
          },
          {
            type: 'text',
            text: 'Extract all text content from this document image. Include all visible text, numbers, and labels.',
          },
        ],
      },
    ],
    max_tokens: 4096,
  })

  const extractedText = response.choices[0]?.message?.content ?? ''

  console.log(`[EXTRACTION] Extracted ${extractedText.length} characters via OpenAI Vision`)

  return {
    markdown: extractedText,
    tables: [],
    pages: [{ index: 0, markdown: extractedText }],
    confidence: extractedText.length > 100 ? 0.85 : 0.6,
    method: 'ocr',
  }
}

async function extractOfficeDocument(buffer: Buffer, mimeType: string): Promise<ExtractionResult> {
  const base64 = buffer.toString('base64')
  const dataUri = `data:${mimeType};base64,${base64}`

  const result = await mistralOCR({
    documentUrl: dataUri,
  })

  return normalizeOCRResult(result)
}

function normalizeOCRResult(result: OCRResult): ExtractionResult {
  return {
    markdown: result.markdown,
    tables: result.tables.map((t) => ({
      id: t.id,
      content: t.content,
      format: t.format,
    })),
    pages: result.pages.map((p) => ({ index: p.index, markdown: p.markdown })),
    confidence: calculateConfidence(result),
    method: 'ocr',
  }
}

function calculateConfidence(result: OCRResult): number {
  // Heuristic: documents with more text and tables = higher confidence
  const totalChars = result.pages.reduce((sum, p) => sum + p.markdown.length, 0)
  const hasReasonableContent = totalChars > 100
  const hasStructure = result.pages.some((p) => (p.tables?.length || 0) > 0)

  if (hasReasonableContent && hasStructure) return 0.95
  if (hasReasonableContent) return 0.85
  return 0.6
}
