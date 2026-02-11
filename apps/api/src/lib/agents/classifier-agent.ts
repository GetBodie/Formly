/**
 * Classifier Agent - Claude Vision with OCR Tool
 * 
 * Claude receives document images directly and classifies using vision.
 * For complex/blurry documents, Claude can call the ocr_extract tool.
 */

import Anthropic from '@anthropic-ai/sdk'
import { extractDocument as mistralOCR } from '../mistral-ocr.js'
import OpenAI from 'openai'

const anthropic = new Anthropic()
const openai = new OpenAI()

// ============================================
// TYPES
// ============================================

export interface ClassificationResult {
  documentType: string
  confidence: number
  taxYear: number | null
  issues: string[]
  extractedFields: Record<string, unknown>
  needsHumanReview: boolean
}

export interface DocumentImage {
  base64: string
  mimeType: string
  presignedUrl?: string  // For Mistral OCR (requires URL)
}

// ============================================
// TOOL DEFINITIONS
// ============================================

const tools: Anthropic.Tool[] = [
  {
    name: 'ocr_extract',
    description: `Run OCR (Optical Character Recognition) on the document to extract text precisely. 
Use this tool when:
- The image is blurry, low resolution, or hard to read
- Text is small, rotated, or overlapping
- You need exact values from form fields (SSN, EIN, dollar amounts)
- The document has complex tables or dense information
- You're unsure about specific characters or numbers

Do NOT use this for simple, clear documents where you can read the text directly.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        reason: {
          type: 'string',
          description: 'Why OCR is needed for this document'
        }
      },
      required: ['reason']
    }
  },
  {
    name: 'extract_fields',
    description: 'Extract fields from the document. Identify the document type and fill in as many fields as possible. Only extract values you can actually see - don\'t hallucinate.',
    input_schema: {
      type: 'object' as const,
      properties: {
        document_type: {
          type: 'string',
          description: 'Best guess: W-2, 1099-NEC, 1099-INT, 1099-DIV, 1099-MISC, K-1, RECEIPT, STATEMENT, or OTHER'
        },
        confidence: {
          type: 'number',
          description: '0-1 confidence in the classification'
        },
        fields: {
          type: 'object',
          description: 'Extracted field values. Keys are field names, values are the extracted data.'
        },
        reasoning: {
          type: 'string',
          description: 'Why you chose this classification'
        }
      },
      required: ['document_type', 'confidence', 'fields', 'reasoning']
    }
  },
  {
    name: 'grade_extraction',
    description: 'Evaluate an extraction attempt. Check: Are required fields filled? Are formats valid (SSN, EIN, currency)? Is this a blank form? Does tax year match? Return PASS if good enough, FAIL with feedback if not.',
    input_schema: {
      type: 'object' as const,
      properties: {
        pass: { type: 'boolean', description: 'Is this extraction good enough?' },
        score: { type: 'number', description: '0-100 quality score' },
        issues: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of issues found (format: [SEVERITY:type:expected:actual] Description)'
        },
        feedback: {
          type: 'string',
          description: 'If FAIL, specific guidance for next extraction attempt'
        }
      },
      required: ['pass', 'score', 'issues']
    }
  }
]

// ============================================
// OCR EXECUTION
// ============================================

/**
 * Perform OCR on the document image
 */
async function performOCR(image: DocumentImage): Promise<string> {
  const { base64, mimeType, presignedUrl } = image
  const dataUri = `data:${mimeType};base64,${base64}`
  
  // For PDFs and Office documents, use Mistral OCR
  if (mimeType === 'application/pdf' || 
      mimeType.includes('openxmlformats') ||
      mimeType.includes('msword') ||
      mimeType.includes('ms-excel')) {
    console.log(`[CLASSIFIER] Using Mistral OCR for ${mimeType}`)
    try {
      // Prefer presigned URL if available, otherwise use data URI
      const result = await mistralOCR({
        documentUrl: presignedUrl || dataUri,
        tableFormat: 'html'
      })
      return result.markdown
    } catch (error) {
      console.warn('[CLASSIFIER] Mistral OCR failed, falling back to OpenAI Vision:', error)
      // Fall through to OpenAI Vision
    }
  }
  
  // For images, use OpenAI Vision as OCR
  console.log('[CLASSIFIER] Using OpenAI Vision for OCR')
  
  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `You are a document OCR system. Extract ALL text content from this document image.
Preserve the document structure as much as possible using markdown formatting.
For tax documents (W-2, 1099, etc.), extract all box numbers and their values.
For tables, format them in markdown.
Be thorough - extract every piece of visible text.`
      },
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: {
              url: dataUri,
              detail: 'high'
            }
          },
          {
            type: 'text',
            text: 'Extract all text content from this document image. Include all visible text, numbers, and labels.'
          }
        ]
      }
    ],
    max_tokens: 4096
  })
  
  return response.choices[0]?.message?.content ?? ''
}

// ============================================
// TOOL EXECUTION
// ============================================

/**
 * Execute a tool call
 */
async function executeToolCall(
  name: string, 
  input: unknown,
  image: DocumentImage,
  ocrCache: { text: string | null }
): Promise<unknown> {
  console.log(`[CLASSIFIER] Tool: ${name}`)
  
  if (name === 'ocr_extract') {
    // Actually perform OCR
    if (!ocrCache.text) {
      console.log(`[CLASSIFIER] OCR requested: ${(input as { reason: string }).reason}`)
      ocrCache.text = await performOCR(image)
      console.log(`[CLASSIFIER] OCR extracted ${ocrCache.text.length} characters`)
    } else {
      console.log('[CLASSIFIER] Using cached OCR result')
    }
    return { 
      status: 'ok',
      text: ocrCache.text.slice(0, 15000) // Limit to prevent token overflow
    }
  }
  
  // Virtual tools - Claude does the real work
  return { status: 'ok', ...(input as object) }
}

// ============================================
// MAIN CLASSIFICATION FUNCTION
// ============================================

/**
 * Classify a document using Claude Vision with optional OCR tool
 * Claude sees the image directly and can request OCR if needed
 */
export async function classifyDocumentAgentic(
  image: DocumentImage,
  fileName: string,
  expectedTaxYear?: number
): Promise<ClassificationResult> {
  const { base64, mimeType } = image
  
  // Pre-check: Validate base64
  if (!base64 || base64.length < 100) {
    console.log(`[CLASSIFIER] Invalid or empty image for ${fileName}`)
    return {
      documentType: 'OTHER',
      confidence: 0.3,
      taxYear: null,
      issues: ['[WARNING:incomplete::] Document image appears to be invalid or empty.'],
      extractedFields: {},
      needsHumanReview: true
    }
  }

  const systemPrompt = `You are a tax document classifier with vision capabilities. You can see the document image directly.

WORKFLOW:
1. Look at the document image
2. If it's clear and readable, call extract_fields directly
3. If it's blurry, low-res, or has complex tables, call ocr_extract first to get precise text
4. Call grade_extraction to evaluate your extraction
5. If grade fails, try extract_fields again with the feedback (max 3 attempts)
6. When satisfied (or after 3 attempts), STOP calling tools and return your final answer

WHEN TO USE OCR:
- Blurry or low resolution images
- Small or hard-to-read text
- Complex tables with many columns
- Forms with dense numerical data
- When you need exact SSN, EIN, or dollar amounts

WHEN NOT TO USE OCR:
- Clear, simple documents you can read easily
- Obvious document types (e.g., a W-2 header is visible)
- When you just need the document type, not exact values

RULES:
- Don't hallucinate field values - only extract what you see
- Blank forms (no filled values) should get low confidence
- If tax year doesn't match ${expectedTaxYear || 'expected'}, flag it as an issue
- After 3 failed attempts, return your best guess with low confidence

WHEN DONE, respond with this exact JSON format (no tool call):
{
  "document_type": "W-2",
  "confidence": 0.85,
  "tax_year": 2024,
  "issues": ["[WARNING:...] description"],
  "extracted_fields": { "wages": 52000, ... },
  "needs_human_review": false
}

---
FILE NAME: ${fileName}
EXPECTED TAX YEAR: ${expectedTaxYear || 'any'}`

  // Build the initial message with the document image
  const imageMediaType = mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
  
  // For PDFs, we need to tell Claude it's looking at a document
  const isPDF = mimeType === 'application/pdf'
  
  const userContent: Anthropic.ContentBlockParam[] = isPDF
    ? [
        {
          type: 'text',
          text: 'Please classify this PDF document. Since I cannot show you the PDF directly, please call ocr_extract to get the text content first.'
        }
      ]
    : [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: imageMediaType,
            data: base64
          }
        },
        {
          type: 'text',
          text: 'Please classify this document. Look at the image directly - only call ocr_extract if you need help reading specific details.'
        }
      ]

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: userContent }
  ]

  // Cache for OCR results (only run once if needed)
  const ocrCache: { text: string | null } = { text: null }
  
  let iterations = 0
  const maxIterations = 10 // Safety limit

  // Agentic loop - Claude drives, we execute tools
  while (iterations < maxIterations) {
    iterations++
    
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      tools,
      messages
    })

    // Check if Claude is done (no more tool calls)
    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
    )
    
    if (toolUseBlocks.length === 0) {
      // Claude is done - parse final answer from text
      const textBlock = response.content.find(
        (b): b is Anthropic.TextBlock => b.type === 'text'
      )
      
      if (textBlock) {
        console.log(`[CLASSIFIER] Done after ${iterations} iterations for ${fileName}${ocrCache.text ? ' (used OCR)' : ' (vision only)'}`)
        return parseClassificationResult(textBlock.text)
      }
      
      // Fallback if no text
      return createFallbackResult('Classification ended without result')
    }

    // Process tool calls
    const toolResults: Anthropic.ToolResultBlockParam[] = []
    
    for (const block of toolUseBlocks) {
      const result = await executeToolCall(block.name, block.input, image, ocrCache)
      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: JSON.stringify(result)
      })
    }

    // Add assistant message and tool result to conversation
    messages.push({ role: 'assistant', content: response.content })
    messages.push({ role: 'user', content: toolResults })
  }

  // Hit safety limit
  console.log(`[CLASSIFIER] Hit max iterations (${maxIterations}) for ${fileName}`)
  return createFallbackResult('Classification loop exceeded maximum iterations')
}

/**
 * Legacy function for backwards compatibility
 * Accepts OCR text directly (old flow)
 */
export async function classifyDocumentFromText(
  ocrText: string,
  fileName: string,
  expectedTaxYear?: number
): Promise<ClassificationResult> {
  // Pre-check: Very minimal content = return early
  const trimmed = ocrText.trim()
  if (trimmed.length < 100) {
    console.log(`[CLASSIFIER] Minimal content (${trimmed.length} chars) for ${fileName}`)
    return {
      documentType: 'OTHER',
      confidence: 0.3,
      taxYear: null,
      issues: ['[WARNING:incomplete::] Document appears to be blank or has minimal content.'],
      extractedFields: {},
      needsHumanReview: true
    }
  }

  // For text-based classification, we use a modified prompt without vision
  const systemPrompt = `You are a tax document classifier. Your goal is to identify the document type and extract key fields.

WORKFLOW:
1. Call extract_fields to analyze the OCR text provided
2. Call grade_extraction to evaluate your extraction
3. If grade fails, try extract_fields again with the feedback (max 3 attempts)
4. When satisfied (or after 3 attempts), STOP calling tools and return your final answer

RULES:
- Don't hallucinate field values - only extract what you see
- Blank forms (no filled values) should get low confidence
- If tax year doesn't match ${expectedTaxYear || 'expected'}, flag it as an issue
- After 3 failed attempts, return your best guess with low confidence

WHEN DONE, respond with this exact JSON format (no tool call):
{
  "document_type": "W-2",
  "confidence": 0.85,
  "tax_year": 2024,
  "issues": ["[WARNING:...] description"],
  "extracted_fields": { "wages": 52000, ... },
  "needs_human_review": false
}

---
FILE NAME: ${fileName}
EXPECTED TAX YEAR: ${expectedTaxYear || 'any'}

OCR TEXT:
${ocrText.slice(0, 15000)}`

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: 'Please classify this document.' }
  ]

  // Use a simpler tool set without OCR (already have text)
  const textTools: Anthropic.Tool[] = tools.filter(t => t.name !== 'ocr_extract')
  
  let iterations = 0
  const maxIterations = 10

  while (iterations < maxIterations) {
    iterations++
    
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      tools: textTools,
      messages
    })

    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
    )
    
    if (toolUseBlocks.length === 0) {
      const textBlock = response.content.find(
        (b): b is Anthropic.TextBlock => b.type === 'text'
      )
      
      if (textBlock) {
        console.log(`[CLASSIFIER] Done after ${iterations} iterations for ${fileName}`)
        return parseClassificationResult(textBlock.text)
      }
      
      return createFallbackResult('Classification ended without result')
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = []
    
    for (const block of toolUseBlocks) {
      const result = { status: 'ok', ...(block.input as object) }
      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: JSON.stringify(result)
      })
    }

    messages.push({ role: 'assistant', content: response.content })
    messages.push({ role: 'user', content: toolResults })
  }

  console.log(`[CLASSIFIER] Hit max iterations (${maxIterations}) for ${fileName}`)
  return createFallbackResult('Classification loop exceeded maximum iterations')
}

// ============================================
// HELPERS
// ============================================

function parseClassificationResult(text: string): ClassificationResult {
  try {
    // Extract JSON from the response
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      return {
        documentType: parsed.document_type || 'OTHER',
        confidence: parsed.confidence || 0.5,
        taxYear: parsed.tax_year || null,
        issues: parsed.issues || [],
        extractedFields: parsed.extracted_fields || {},
        needsHumanReview: parsed.needs_human_review || false
      }
    }
  } catch (e) {
    console.error('[CLASSIFIER] Failed to parse result:', e)
  }
  
  return createFallbackResult('Could not parse classification result')
}

function createFallbackResult(reason: string): ClassificationResult {
  return {
    documentType: 'OTHER',
    confidence: 0.3,
    taxYear: null,
    issues: [`[WARNING:parse_error::] ${reason}`],
    extractedFields: {},
    needsHumanReview: true
  }
}

export default { classifyDocumentAgentic, classifyDocumentFromText }
