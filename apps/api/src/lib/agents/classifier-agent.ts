/**
 * Classifier Agent - Claude Agent SDK with tool_use pattern
 * 
 * Claude orchestrates the extract → grade loop.
 * Tools are "virtual" - Claude both calls and evaluates them.
 * We just log and return acknowledgments.
 */

import Anthropic from '@anthropic-ai/sdk'

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
    description: 'Extract fields from the OCR text. Identify the document type and fill in as many fields as possible. Only extract values you can actually see - don\'t hallucinate.',
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
// TOOL EXECUTION
// ============================================

/**
 * Execute a tool call - tools are "virtual", Claude does the real work.
 * We just log and return the input as acknowledgment.
 */
function executeToolCall(name: string, input: unknown): unknown {
  console.log(`[CLASSIFIER] Tool: ${name}`)
  // Return the input back - Claude uses this for its reasoning
  return { status: 'ok', ...(input as object) }
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

  const systemPrompt = `You are a tax document classifier. Your goal is to identify the document type and extract key fields.

WORKFLOW:
1. Call extract_fields to analyze the OCR text
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
        console.log(`[CLASSIFIER] Done after ${iterations} iterations for ${fileName}`)
        return parseClassificationResult(textBlock.text)
      }
      
      // Fallback if no text
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

    // Add assistant message and tool result to conversation
    messages.push({ role: 'assistant', content: response.content })
    messages.push({ role: 'user', content: toolResults })
  }

  // Hit safety limit
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

export default { classifyDocumentAgentic }
