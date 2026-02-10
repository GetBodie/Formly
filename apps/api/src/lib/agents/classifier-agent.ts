/**
 * Classifier Agent - Claude Agent SDK with tool_use pattern
 * 
 * Claude orchestrates the extract → grade → feedback loop.
 * Tools define capabilities, Claude decides when to call them and when to stop.
 */

import Anthropic from '@anthropic-ai/sdk'
import { getFormTemplate, getKnownDocumentTypes } from '../form-templates.js'
import { validateFormat } from './grader.js'

const anthropic = new Anthropic()

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

// ============================================
// TOOL DEFINITIONS
// ============================================

const tools: Anthropic.Tool[] = [
  {
    name: 'extract_fields',
    description: `Extract fields from the OCR text. Try to identify the document type and fill in as many fields as possible. Only extract values you can actually see - don't hallucinate. Known form types: ${getKnownDocumentTypes().join(', ')}, RECEIPT, STATEMENT, OTHER.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        document_type: {
          type: 'string',
          description: 'Best guess: W-2, 1099-NEC, 1099-INT, 1099-DIV, 1099-MISC, 1099-B, 1099-R, K-1, RECEIPT, STATEMENT, or OTHER'
        },
        confidence: {
          type: 'number',
          description: '0-1 confidence in the classification'
        },
        fields: {
          type: 'object',
          description: 'Extracted field values. Keys are field names (e.g., employee_ssn, wages_tips), values are the extracted data.'
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
    description: `Evaluate an extraction attempt. Check: Are required fields filled? Are formats valid (SSN, EIN, currency)? Is this a blank form? Does tax year match? Return PASS if good enough, FAIL with feedback if not. Use your judgment - you're the expert.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        pass: { type: 'boolean', description: 'Is this extraction good enough to accept?' },
        score: { type: 'number', description: '0-100 quality score' },
        document_type: { type: 'string', description: 'Confirmed or corrected document type' },
        confidence: { type: 'number', description: 'Final confidence (0-1)' },
        issues: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of issues found (format: [SEVERITY:type:expected:actual] Description)'
        },
        feedback: {
          type: 'string',
          description: 'If FAIL, specific guidance for next extraction attempt'
        },
        reasoning: {
          type: 'string',
          description: 'Brief explanation of your grading decision'
        }
      },
      required: ['pass', 'score', 'document_type', 'confidence', 'issues', 'reasoning']
    }
  },
  {
    name: 'validate_field_format',
    description: 'Validate a field value against a specific format. Use this to check SSN, EIN, currency amounts, etc.',
    input_schema: {
      type: 'object' as const,
      properties: {
        value: { type: 'string', description: 'The value to validate' },
        format: { 
          type: 'string', 
          enum: ['ssn', 'ein', 'currency', 'date', 'percentage'],
          description: 'The format to validate against' 
        }
      },
      required: ['value', 'format']
    }
  }
]

// ============================================
// TOOL EXECUTION
// ============================================

interface ExtractFieldsInput {
  document_type: string
  confidence: number
  fields: Record<string, unknown>
  reasoning: string
}

interface GradeExtractionInput {
  pass: boolean
  score: number
  document_type: string
  confidence: number
  issues: string[]
  feedback?: string
  reasoning: string
}

interface ValidateFormatInput {
  value: string
  format: 'ssn' | 'ein' | 'currency' | 'date' | 'percentage'
}

function executeToolCall(name: string, input: unknown): unknown {
  // Log tool calls for debugging
  console.log(`[CLASSIFIER] Tool: ${name}`)
  
  switch (name) {
    case 'extract_fields': {
      // Extraction is done by Claude - we just acknowledge and optionally enrich
      const extraction = input as ExtractFieldsInput
      const template = getFormTemplate(extraction.document_type)
      return {
        status: 'ok',
        extraction,
        template_hint: {
          type: template.type,
          required_fields: template.fields.filter(f => f.required).map(f => f.name),
          confidence_threshold: template.confidenceThreshold
        }
      }
    }
    
    case 'grade_extraction': {
      // Grading is done by Claude's LLM reasoning - we just acknowledge
      const grade = input as GradeExtractionInput
      return {
        status: 'ok',
        grade
      }
    }
    
    case 'validate_field_format': {
      // This is the one deterministic helper - format validation
      const { value, format } = input as ValidateFormatInput
      const result = validateFormat(value, format)
      return {
        status: 'ok',
        value,
        format,
        valid: result.valid,
        issue: result.issue || null
      }
    }
    
    default:
      return { status: 'error', message: `Unknown tool: ${name}` }
  }
}

// ============================================
// MAIN CLASSIFICATION FUNCTION
// ============================================

/**
 * Classify a document using Claude Agent SDK
 * Claude drives the loop, decides when to retry, and when to stop
 */
export async function classifyDocumentAgentic(
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

  const systemPrompt = `You are an expert tax document classifier. Your goal is to identify the document type and extract key fields.

WORKFLOW:
1. Call extract_fields to analyze the OCR text - identify the document type and extract all visible values
2. Call grade_extraction to evaluate your extraction - is it good enough?
3. If grade fails, call extract_fields again with the feedback (max 3 total attempts)
4. When satisfied (or after 3 attempts), STOP calling tools and return your final answer

VALIDATION:
- Use validate_field_format to check SSN (XXX-XX-XXXX), EIN (XX-XXXXXXX), and currency formats
- Don't hallucinate field values - only extract what you can actually see in the text
- Blank forms (no filled values) should be classified as OTHER with low confidence

TAX YEAR CHECK:
${expectedTaxYear ? `- Expected tax year: ${expectedTaxYear}. If document shows a different year, flag it as [ERROR:wrong_year:${expectedTaxYear}:actual] in issues.` : '- No specific tax year expected.'}

GRADING CRITERIA:
- PASS if: Document type identified with ≥0.7 confidence, critical fields filled, no major errors
- FAIL if: Can't identify type, most fields empty, blank form detected, wrong tax year, inconsistent data

ON LATER ATTEMPTS:
- Attempt 2: Consider if it might be a different form type
- Attempt 3: Focus only on critical fields, accept partial results

WHEN DONE (after PASS or 3 attempts), respond with ONLY this JSON (no tool calls):
{
  "document_type": "W-2",
  "confidence": 0.85,
  "tax_year": 2024,
  "issues": ["[WARNING:...] description"],
  "extracted_fields": { "wages_tips": 52000, "employee_ssn": "***-**-1234" },
  "needs_human_review": false
}

---
FILE NAME: ${fileName}
OCR TEXT (first 15000 chars):
${ocrText.slice(0, 15000)}`

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: 'Please classify this tax document. Use the tools to extract fields and grade your extraction.' }
  ]

  let attempts = 0
  const maxAttempts = 10 // Safety limit on total tool calls

  while (attempts < maxAttempts) {
    attempts++
    
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      tools,
      messages
    })

    // Check if Claude is done (stop_reason is 'end' or no tool calls)
    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
    )
    
    if (toolUseBlocks.length === 0 || response.stop_reason === 'end_turn') {
      // Claude is done - parse final answer from text
      const textBlock = response.content.find(
        (b): b is Anthropic.TextBlock => b.type === 'text'
      )
      
      if (textBlock) {
        console.log(`[CLASSIFIER] Completed after ${attempts} API calls for ${fileName}`)
        return parseClassificationResult(textBlock.text)
      }
      
      // No text block - return fallback
      return createFallbackResult('Classification ended without result')
    }

    // Process tool calls
    const toolResults: Anthropic.ToolResultBlockParam[] = []
    
    for (const block of toolUseBlocks) {
      const result = executeToolCall(block.name, block.input)
      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: JSON.stringify(result)
      })
    }

    // Add assistant response and tool results to conversation
    messages.push({ role: 'assistant', content: response.content })
    messages.push({ role: 'user', content: toolResults })
  }

  // Hit safety limit
  console.log(`[CLASSIFIER] Hit max attempts (${maxAttempts}) for ${fileName}`)
  return createFallbackResult('Classification loop exceeded maximum iterations')
}

// ============================================
// HELPER FUNCTIONS
// ============================================

function parseClassificationResult(text: string): ClassificationResult {
  try {
    // Extract JSON from the response (handle markdown code blocks)
    let jsonStr = text
    const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1]
    } else {
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        jsonStr = jsonMatch[0]
      }
    }
    
    const parsed = JSON.parse(jsonStr)
    
    return {
      documentType: parsed.document_type || 'OTHER',
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
      taxYear: typeof parsed.tax_year === 'number' ? parsed.tax_year : null,
      issues: Array.isArray(parsed.issues) ? parsed.issues : [],
      extractedFields: typeof parsed.extracted_fields === 'object' ? parsed.extracted_fields : {},
      needsHumanReview: parsed.needs_human_review ?? false
    }
  } catch (e) {
    console.error('[CLASSIFIER] Failed to parse result:', e)
    console.error('[CLASSIFIER] Raw text:', text.slice(0, 500))
    return createFallbackResult('Could not parse classification result')
  }
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

export default { classifyDocumentAgentic }
