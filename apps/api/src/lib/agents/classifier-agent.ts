/**
 * Classifier Agent - Two-level reflection with Claude Opus orchestrating
 *
 * Architecture:
 *   Claude Opus (Level 1: Agent Strategy — decides which tool, which type, when to stop)
 *     ├── ocr_extract      → Mistral OCR / OpenAI Vision → raw text
 *     ├── vision_extract   → GPT-4o sees image → fields → GPT-4o-mini grades → Grade
 *     └── extract_fields   → GPT-4o reads OCR text → fields → GPT-4o-mini grades → Grade
 *
 * Level 2: Prior feedback retry_instructions injected into extraction prompts on retries.
 * Harness manages: bestResult selection, extraction budget (max 3), tool stripping.
 */

import Anthropic from '@anthropic-ai/sdk'
import { extractDocument as mistralOCR } from '../mistral-ocr.js'
import OpenAI from 'openai'
import { zodResponseFormat } from 'openai/helpers/zod'
import { z } from 'zod'
import { CLASSIFIABLE_DOCUMENT_TYPES } from '../../types.js'
import { normalizeIssues } from '../issues.js'

const anthropic = new Anthropic()
const openai = new OpenAI()

const MAX_EXTRACTIONS = 3
const MAX_ITERATIONS = 5
const GOOD_SCORE_THRESHOLD = 0.85

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
  presignedUrl?: string
}

interface PriorFeedback {
  issues: string[]
  suggestion: string
  fields_to_recheck: string[]
  retry_instructions: string
}

interface Grade {
  score: number
  issues: string[]
  likely_correct_type: boolean
  suggestion: string
  retry_instructions: string
}

interface ExtractionAttempt {
  document_type: string
  extracted_fields: Record<string, unknown>
  grade: Grade
  method: 'vision' | 'text'
}

// ============================================
// PER-TYPE EXTRACTION SCHEMAS (for GPT-4o)
// ============================================

const W2Schema = z.object({
  employer_name: z.string().nullable(),
  employer_ein: z.string().nullable(),
  employee_name: z.string().nullable(),
  employee_ssn: z.string().nullable(),
  wages_box1: z.number().nullable(),
  federal_tax_withheld_box2: z.number().nullable(),
  social_security_wages_box3: z.number().nullable(),
  medicare_wages_box5: z.number().nullable(),
  state: z.string().nullable(),
  state_wages: z.number().nullable(),
  state_tax: z.number().nullable(),
  tax_year: z.number().nullable(),
})

const NEC1099Schema = z.object({
  payer_name: z.string().nullable(),
  payer_tin: z.string().nullable(),
  recipient_name: z.string().nullable(),
  recipient_tin: z.string().nullable(),
  nonemployee_compensation_box1: z.number().nullable(),
  federal_tax_withheld: z.number().nullable(),
  tax_year: z.number().nullable(),
})

const INT1099Schema = z.object({
  payer_name: z.string().nullable(),
  interest_income_box1: z.number().nullable(),
  early_withdrawal_penalty_box2: z.number().nullable(),
  federal_tax_withheld: z.number().nullable(),
  tax_year: z.number().nullable(),
})

const MISC1099Schema = z.object({
  payer_name: z.string().nullable(),
  rents_box1: z.number().nullable(),
  royalties_box2: z.number().nullable(),
  other_income_box3: z.number().nullable(),
  federal_tax_withheld: z.number().nullable(),
  tax_year: z.number().nullable(),
})

const DIV1099Schema = z.object({
  payer_name: z.string().nullable(),
  ordinary_dividends_box1a: z.number().nullable(),
  qualified_dividends_box1b: z.number().nullable(),
  capital_gain_distributions_box2a: z.number().nullable(),
  federal_tax_withheld: z.number().nullable(),
  tax_year: z.number().nullable(),
})

const B1099Schema = z.object({
  payer_name: z.string().nullable(),
  description_box1a: z.string().nullable(),
  date_sold_box1c: z.string().nullable(),
  proceeds_box1d: z.number().nullable(),
  cost_basis_box1e: z.number().nullable(),
  gain_loss: z.number().nullable(),
  short_term: z.boolean().nullable(),
  federal_tax_withheld: z.number().nullable(),
  tax_year: z.number().nullable(),
})

const R1099Schema = z.object({
  payer_name: z.string().nullable(),
  gross_distribution_box1: z.number().nullable(),
  taxable_amount_box2a: z.number().nullable(),
  federal_tax_withheld_box4: z.number().nullable(),
  distribution_code_box7: z.string().nullable(),
  ira_sep_simple: z.boolean().nullable(),
  tax_year: z.number().nullable(),
})

const G1099Schema = z.object({
  payer_name: z.string().nullable(),
  unemployment_compensation_box1: z.number().nullable(),
  state_local_tax_refund_box2: z.number().nullable(),
  federal_tax_withheld: z.number().nullable(),
  tax_year: z.number().nullable(),
})

const K1099Schema = z.object({
  payer_name: z.string().nullable(),
  gross_amount_box1a: z.number().nullable(),
  card_not_present_box1b: z.number().nullable(),
  number_of_transactions: z.number().nullable(),
  federal_tax_withheld: z.number().nullable(),
  tax_year: z.number().nullable(),
})

const SSA1099Schema = z.object({
  beneficiary_name: z.string().nullable(),
  total_benefits_box3: z.number().nullable(),
  benefits_repaid_box4: z.number().nullable(),
  net_benefits_box5: z.number().nullable(),
  voluntary_tax_withheld_box6: z.number().nullable(),
  tax_year: z.number().nullable(),
})

const Mortgage1098Schema = z.object({
  lender_name: z.string().nullable(),
  mortgage_interest_box1: z.number().nullable(),
  points_paid_box2: z.number().nullable(),
  mortgage_insurance_premiums_box5: z.number().nullable(),
  outstanding_principal: z.number().nullable(),
  tax_year: z.number().nullable(),
})

const Tuition1098TSchema = z.object({
  institution_name: z.string().nullable(),
  payments_received_box1: z.number().nullable(),
  scholarships_box5: z.number().nullable(),
  student_name: z.string().nullable(),
  tax_year: z.number().nullable(),
})

const ScheduleASchema = z.object({
  medical_expenses: z.number().nullable(),
  state_local_taxes: z.number().nullable(),
  mortgage_interest: z.number().nullable(),
  charitable_contributions: z.number().nullable(),
  total_itemized_deductions: z.number().nullable(),
  tax_year: z.number().nullable(),
})

const ScheduleCSchema = z.object({
  business_name: z.string().nullable(),
  principal_business: z.string().nullable(),
  ein: z.string().nullable(),
  gross_receipts: z.number().nullable(),
  total_expenses: z.number().nullable(),
  net_profit_loss: z.number().nullable(),
  tax_year: z.number().nullable(),
})

const ScheduleDSchema = z.object({
  short_term_gain_loss: z.number().nullable(),
  long_term_gain_loss: z.number().nullable(),
  net_gain_loss: z.number().nullable(),
  tax_year: z.number().nullable(),
})

const ScheduleESchema = z.object({
  property_type: z.string().nullable(),
  property_address: z.string().nullable(),
  rents_received: z.number().nullable(),
  total_expenses: z.number().nullable(),
  net_income_loss: z.number().nullable(),
  tax_year: z.number().nullable(),
})

const K1Schema = z.object({
  entity_name: z.string().nullable(),
  entity_ein: z.string().nullable(),
  partner_name: z.string().nullable(),
  partner_tin: z.string().nullable(),
  ordinary_income: z.number().nullable(),
  guaranteed_payments: z.number().nullable(),
  tax_year: z.number().nullable(),
})

const Form1065Schema = z.object({
  partnership_name: z.string().nullable(),
  ein: z.string().nullable(),
  total_income: z.number().nullable(),
  total_deductions: z.number().nullable(),
  ordinary_income: z.number().nullable(),
  tax_year: z.number().nullable(),
})

const Form1120SSchema = z.object({
  corporation_name: z.string().nullable(),
  ein: z.string().nullable(),
  total_income: z.number().nullable(),
  total_deductions: z.number().nullable(),
  ordinary_income: z.number().nullable(),
  tax_year: z.number().nullable(),
})

const Form941Schema = z.object({
  employer_name: z.string().nullable(),
  ein: z.string().nullable(),
  number_of_employees: z.number().nullable(),
  wages_tips: z.number().nullable(),
  federal_tax_withheld: z.number().nullable(),
  quarter: z.number().nullable(),
  tax_year: z.number().nullable(),
})

const ReceiptSchema = z.object({
  vendor_name: z.string().nullable(),
  date: z.string().nullable(),
  total_amount: z.number().nullable(),
  description: z.string().nullable(),
  category: z.string().nullable(),
})

const StatementSchema = z.object({
  institution_name: z.string().nullable(),
  account_type: z.string().nullable(),
  period_start: z.string().nullable(),
  period_end: z.string().nullable(),
  ending_balance: z.number().nullable(),
})

const GenericSchema = z.object({
  description: z.string().nullable(),
  key_values: z.record(z.string(), z.string()).nullable(),
})

type SchemaConfig = { schema: z.ZodObject<z.ZodRawShape>; name: string }

const EXTRACTION_SCHEMAS: Record<string, SchemaConfig> = {
  'W-2': { schema: W2Schema, name: 'w2_extraction' },
  '1099-NEC': { schema: NEC1099Schema, name: 'nec1099_extraction' },
  '1099-INT': { schema: INT1099Schema, name: 'int1099_extraction' },
  '1099-MISC': { schema: MISC1099Schema, name: 'misc1099_extraction' },
  '1099-DIV': { schema: DIV1099Schema, name: 'div1099_extraction' },
  '1099-B': { schema: B1099Schema, name: 'b1099_extraction' },
  '1099-R': { schema: R1099Schema, name: 'r1099_extraction' },
  '1099-G': { schema: G1099Schema, name: 'g1099_extraction' },
  '1099-K': { schema: K1099Schema, name: 'k1099_extraction' },
  'SSA-1099': { schema: SSA1099Schema, name: 'ssa1099_extraction' },
  '1098': { schema: Mortgage1098Schema, name: 'mortgage1098_extraction' },
  '1098-T': { schema: Tuition1098TSchema, name: 'tuition1098t_extraction' },
  'SCHEDULE-A': { schema: ScheduleASchema, name: 'schedule_a_extraction' },
  'SCHEDULE-C': { schema: ScheduleCSchema, name: 'schedule_c_extraction' },
  'SCHEDULE-D': { schema: ScheduleDSchema, name: 'schedule_d_extraction' },
  'SCHEDULE-E': { schema: ScheduleESchema, name: 'schedule_e_extraction' },
  'K-1': { schema: K1Schema, name: 'k1_extraction' },
  'FORM-1065': { schema: Form1065Schema, name: 'form1065_extraction' },
  'FORM-1120-S': { schema: Form1120SSchema, name: 'form1120s_extraction' },
  'FORM-941': { schema: Form941Schema, name: 'form941_extraction' },
  'RECEIPT': { schema: ReceiptSchema, name: 'receipt_extraction' },
  'STATEMENT': { schema: StatementSchema, name: 'statement_extraction' },
  'OTHER': { schema: GenericSchema, name: 'generic_extraction' },
}

// ============================================
// LLM GRADING (GPT-4o-mini)
// ============================================

const GradeSchema = z.object({
  score: z.number(),
  issues: z.array(z.string()),
  likely_correct_type: z.boolean(),
  suggestion: z.string(),
  retry_instructions: z.string(),
})

export async function gradeWithLLM(
  fields: Record<string, unknown>,
  documentType: string
): Promise<Grade> {
  const response = await openai.chat.completions.parse({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `You are a tax form quality reviewer. Given extracted fields for a ${documentType}, evaluate:
1. Could you fill out this form with this data? What critical fields are missing?
2. Are the values reasonable? (e.g., wages of $0.03 is suspicious, EIN should be XX-XXXXXXX format)
3. Is this actually a ${documentType}? Could it be a different form type?
4. Is this a blank/template form with no real data?

Score 0.0-1.0:
- 0.90-1.0: All critical fields present with reasonable values
- 0.70-0.89: Most fields present, minor issues
- 0.50-0.69: Key fields missing or suspicious values
- 0.0-0.49: Wrong form type, blank form, or mostly unreadable

ISSUE FORMAT (STRICT - follow exactly):
Each issue MUST be formatted as: [SEVERITY:type:expected:detected] Human-readable description

- Wrap the code portion in square brackets []
- SEVERITY: ERROR (blocks tax prep) or WARNING (needs review)
- type: missing_field, wrong_year, invalid_format, wrong_type, incomplete, suspicious_value
- expected/detected: the actual values (use "null" if not detected)
- Human-readable description: A plain English explanation that a user can understand (REQUIRED!)

CORRECT EXAMPLES:
✓ [ERROR:missing_field:employer_name:null] Employer name is required but was not found on the document
✓ [ERROR:missing_field:wages_box1:null] Wages in Box 1 are missing - this is required for W-2 processing
✓ [WARNING:suspicious_value:wages_box1:0.03] Wages amount of $0.03 seems unusually low
✓ [ERROR:invalid_format:employer_ein:1234567] EIN should be in XX-XXXXXXX format
✓ [WARNING:wrong_year:2024:2023] Document appears to be from tax year 2023, expected 2024
✓ [ERROR:wrong_type:W-2:1099-NEC] This appears to be a 1099-NEC, not a W-2

WRONG EXAMPLES (DO NOT output like this):
✗ ERROR:missing_field:employer_name:detected:null  (missing brackets and description)
✗ missing_field:employer_name  (missing severity, brackets, and description)
✗ [ERROR:missing_field:employer_name:null]  (missing human-readable description after brackets)

IMPORTANT: Always provide retry_instructions — actionable directions for the extraction model
to improve on the next attempt. Be specific about WHERE to look on the form.
Examples:
- "Look for EIN in box (b), top-left corner. Check box 1 for wages — may be obscured."
- "This appears to be a 1099-MISC, not a W-2. Look for boxes 1-3 (rents, royalties, other income)."
NOT: "score was 0.6, employer_ein missing" (not actionable)`
      },
      {
        role: 'user',
        content: `Document type: ${documentType}\n\nExtracted fields:\n${JSON.stringify(fields, null, 2)}`
      }
    ],
    response_format: zodResponseFormat(GradeSchema, 'grade'),
    temperature: 0,
  })

  const parsed = response.choices[0]?.message?.parsed
  if (!parsed) {
    return {
      score: 0.5,
      issues: ['[WARNING:parse_error::] Grading failed — could not parse response'],
      likely_correct_type: true,
      suggestion: 'Grading unavailable',
      retry_instructions: 'Try extracting again with more care for field locations.',
    }
  }

  // Normalize issues to ensure consistent format (safety net for LLM output)
  return {
    ...parsed,
    issues: normalizeIssues(parsed.issues),
  }
}

// ============================================
// GPT-4o FIELD EXTRACTION (text-based)
// ============================================

async function extractFieldsWithGPT(
  ocrText: string,
  documentType: string,
  fileName: string,
  priorFeedback: PriorFeedback | null
): Promise<Record<string, unknown>> {
  const config = EXTRACTION_SCHEMAS[documentType] || EXTRACTION_SCHEMAS['OTHER']

  let systemContent = `You are a tax document field extractor. Extract values from the OCR text into the structured format.
Only extract values you can clearly see in the text. Use null for missing/unclear fields.
For currency amounts, use plain numbers (no $ or commas).
For dates, use YYYY-MM-DD format.`

  if (priorFeedback) {
    systemContent += `

--- PRIOR ATTEMPT FEEDBACK ---
The previous extraction attempt had issues:
${priorFeedback.retry_instructions}

Fields to recheck: ${priorFeedback.fields_to_recheck.join(', ')}

Please pay special attention to these areas.`
  }

  const response = await openai.chat.completions.parse({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: systemContent },
      {
        role: 'user',
        content: `Document type: ${documentType}\nFile: ${fileName}\n\nOCR Text:\n${ocrText.slice(0, 12000)}`
      }
    ],
    response_format: zodResponseFormat(config.schema, config.name),
    temperature: 0,
  })

  const parsed = response.choices[0]?.message?.parsed
  return (parsed as Record<string, unknown>) ?? {}
}

// ============================================
// GPT-4o VISION FIELD EXTRACTION (image-based)
// ============================================

async function extractFieldsWithVision(
  image: DocumentImage,
  documentType: string,
  priorFeedback: PriorFeedback | null
): Promise<Record<string, unknown>> {
  const config = EXTRACTION_SCHEMAS[documentType] || EXTRACTION_SCHEMAS['OTHER']
  const dataUri = `data:${image.mimeType};base64,${image.base64}`

  let systemContent = `You are a tax document field extractor with vision capabilities. Look at the document image and extract values into the structured format.
Only extract values you can clearly see. Use null for missing/unclear fields.
For currency amounts, use plain numbers (no $ or commas).
For dates, use YYYY-MM-DD format.`

  if (priorFeedback) {
    systemContent += `

--- PRIOR ATTEMPT FEEDBACK ---
The previous extraction attempt had issues:
${priorFeedback.retry_instructions}

Fields to recheck: ${priorFeedback.fields_to_recheck.join(', ')}

Please pay special attention to these areas.`
  }

  const response = await openai.chat.completions.parse({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: systemContent },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: dataUri, detail: 'high' } },
          { type: 'text', text: `Document type: ${documentType}\nExtract all fields from this document.` }
        ]
      }
    ],
    response_format: zodResponseFormat(config.schema, config.name),
    temperature: 0,
  })

  const parsed = response.choices[0]?.message?.parsed
  return (parsed as Record<string, unknown>) ?? {}
}

// ============================================
// OCR
// ============================================

async function performOCR(image: DocumentImage): Promise<string> {
  const { base64, mimeType, presignedUrl } = image
  const dataUri = `data:${mimeType};base64,${base64}`

  if (mimeType === 'application/pdf' ||
      mimeType.includes('openxmlformats') ||
      mimeType.includes('msword') ||
      mimeType.includes('ms-excel')) {
    console.log(`[CLASSIFIER] Using Mistral OCR for ${mimeType}`)
    try {
      const result = await mistralOCR({
        documentUrl: presignedUrl || dataUri,
        tableFormat: 'html'
      })
      return result.markdown
    } catch (error) {
      console.warn('[CLASSIFIER] Mistral OCR failed, falling back to OpenAI Vision:', error)
    }
  }

  console.log('[CLASSIFIER] Using OpenAI Vision for OCR')
  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `You are a document OCR system. Extract ALL text content from this document image.
Preserve structure using markdown. For tax forms, extract all box numbers and values.
Be thorough - extract every piece of visible text.`
      },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: dataUri, detail: 'high' } },
          { type: 'text', text: 'Extract all text from this document.' }
        ]
      }
    ],
    max_tokens: 4096
  })

  return response.choices[0]?.message?.content ?? ''
}

// ============================================
// TOOL DEFINITIONS
// ============================================

const DOC_TYPE_ENUM = [...CLASSIFIABLE_DOCUMENT_TYPES] as string[]

function buildTools(): Anthropic.Tool[] {
  return [
    {
      name: 'ocr_extract',
      description: `Run OCR on the document to extract text. Use when:
- Image is blurry or hard to read
- You need exact values (SSN, EIN, dollar amounts)
- Complex tables or dense info
- PDF documents (always use for PDFs)
Do NOT use for clear, simple documents you can read directly from the image.`,
      input_schema: {
        type: 'object' as const,
        properties: {
          reason: { type: 'string', description: 'Why OCR is needed' }
        },
        required: ['reason']
      }
    },
    {
      name: 'vision_extract',
      description: `Extract structured fields by looking at the document image directly (GPT-4o vision).
Best for clear images where visual layout matters. Returns extracted fields + a quality grade.
Use this as your FIRST extraction attempt for image documents.`,
      input_schema: {
        type: 'object' as const,
        properties: {
          document_type: {
            type: 'string',
            enum: DOC_TYPE_ENUM,
            description: 'Your best guess at the document type'
          },
          reasoning: { type: 'string', description: 'Why you chose this type' }
        },
        required: ['document_type', 'reasoning']
      }
    },
    {
      name: 'extract_fields',
      description: `Extract structured fields from OCR text using GPT-4o.
If OCR hasn't been run yet, it will run automatically.
Returns extracted fields + a quality grade.
Use this when vision_extract scored low, or for text-heavy/blurry documents.`,
      input_schema: {
        type: 'object' as const,
        properties: {
          document_type: {
            type: 'string',
            enum: DOC_TYPE_ENUM,
            description: 'Your best guess at the document type'
          },
          reasoning: { type: 'string', description: 'Why you chose this type' }
        },
        required: ['document_type', 'reasoning']
      }
    }
  ]
}

// ============================================
// TOOL EXECUTION
// ============================================

async function executeToolCall(
  name: string,
  input: unknown,
  image: DocumentImage,
  ocrCache: { text: string | null },
  fileName: string,
  priorFeedback: PriorFeedback | null
): Promise<{ result: unknown; attempt?: ExtractionAttempt }> {
  console.log(`[CLASSIFIER] Tool: ${name}`)

  if (name === 'ocr_extract') {
    if (!ocrCache.text) {
      console.log(`[CLASSIFIER] OCR requested: ${(input as { reason: string }).reason}`)
      ocrCache.text = await performOCR(image)
      console.log(`[CLASSIFIER] OCR extracted ${ocrCache.text.length} characters`)
    } else {
      console.log('[CLASSIFIER] Using cached OCR result')
    }
    return {
      result: { text: ocrCache.text.slice(0, 15000), char_count: ocrCache.text.length }
    }
  }

  if (name === 'vision_extract') {
    const { document_type, reasoning } = input as { document_type: string; reasoning: string }
    console.log(`[CLASSIFIER] Vision extracting fields for ${document_type}: ${reasoning}`)

    if (priorFeedback) {
      console.log('[CLASSIFIER] Injecting prior feedback into vision extraction prompt')
    }

    const fields = await extractFieldsWithVision(image, document_type, priorFeedback)
    const fieldCount = Object.values(fields).filter(v => v !== null).length
    console.log(`[CLASSIFIER] GPT-4o extracted ${fieldCount} fields`)

    const grade = await gradeWithLLM(fields, document_type)
    console.log(`[CLASSIFIER] Grade: ${grade.score.toFixed(2)}, issues: ${grade.issues.length}`)

    const attempt: ExtractionAttempt = {
      document_type,
      extracted_fields: fields,
      grade,
      method: 'vision',
    }

    return {
      result: {
        document_type,
        extracted_fields: fields,
        grade: {
          score: grade.score,
          issues: grade.issues,
          likely_correct_type: grade.likely_correct_type,
          suggestion: grade.suggestion,
        },
        method: 'vision',
      },
      attempt,
    }
  }

  if (name === 'extract_fields') {
    const { document_type, reasoning } = input as { document_type: string; reasoning: string }
    console.log(`[CLASSIFIER] Text extracting fields for ${document_type}: ${reasoning}`)

    if (!ocrCache.text) {
      console.log('[CLASSIFIER] Auto-running OCR for extract_fields')
      ocrCache.text = await performOCR(image)
      console.log(`[CLASSIFIER] OCR extracted ${ocrCache.text.length} characters`)
    }

    if (priorFeedback) {
      console.log('[CLASSIFIER] Injecting prior feedback into text extraction prompt')
    }

    const fields = await extractFieldsWithGPT(ocrCache.text, document_type, fileName, priorFeedback)
    const fieldCount = Object.values(fields).filter(v => v !== null).length
    console.log(`[CLASSIFIER] GPT-4o extracted ${fieldCount} fields`)

    const grade = await gradeWithLLM(fields, document_type)
    console.log(`[CLASSIFIER] Grade: ${grade.score.toFixed(2)}, issues: ${grade.issues.length}`)

    const attempt: ExtractionAttempt = {
      document_type,
      extracted_fields: fields,
      grade,
      method: 'text',
    }

    return {
      result: {
        document_type,
        extracted_fields: fields,
        grade: {
          score: grade.score,
          issues: grade.issues,
          likely_correct_type: grade.likely_correct_type,
          suggestion: grade.suggestion,
        },
        method: 'text',
      },
      attempt,
    }
  }

  return { result: { status: 'error', message: `Unknown tool: ${name}` } }
}

// ============================================
// SYSTEM PROMPT
// ============================================

function buildSystemPrompt(fileName: string, expectedTaxYear?: number): string {
  return `You are a tax document classifier. Your job is to identify the document type and extract structured fields.
Treat this as a form-filling problem: "Given this document, could I fill out the corresponding IRS form?"

ALLOWED DOCUMENT TYPES (23):
Personal Income:
  W-2 — Wage and Tax Statement (boxes: employer info, wages box 1, fed tax box 2, SSN, EIN)
  1099-NEC — Nonemployee Compensation (box 1: NEC amount, payer/recipient info)
  1099-INT — Interest Income (box 1: interest, payer info)
  1099-DIV — Dividends (box 1a: ordinary, box 1b: qualified, box 2a: cap gains)
  1099-B — Proceeds from Broker Transactions (proceeds, cost basis, gain/loss)
  1099-R — Distributions from Pensions/IRAs (box 1: gross dist, box 2a: taxable, box 7: dist code)
  1099-MISC — Miscellaneous Income (boxes 1-3: rents, royalties, other income)
  1099-G — Government Payments (box 1: unemployment, box 2: state tax refund)
  1099-K — Payment Card/Third Party Network (box 1a: gross amount)
  SSA-1099 — Social Security Benefit Statement (box 3: total benefits, box 5: net benefits)

Deductions & Credits:
  1098 — Mortgage Interest Statement (box 1: mortgage interest, box 2: points)
  1098-T — Tuition Statement (box 1: payments received, box 5: scholarships)
  SCHEDULE-A — Itemized Deductions (medical, taxes, interest, charitable)
  SCHEDULE-C — Profit or Loss from Business (gross receipts, expenses, net profit)
  SCHEDULE-D — Capital Gains and Losses (short-term, long-term, net)
  SCHEDULE-E — Supplemental Income (rental income, expenses)

Business:
  K-1 — Partner's/Shareholder's Share (entity info, ordinary income, guaranteed payments)
  FORM-1065 — Partnership Return (income, deductions, ordinary income)
  FORM-1120-S — S Corporation Return (income, deductions, ordinary income)
  FORM-941 — Employer's Quarterly Federal Tax Return (wages, employees, withholding)

Generic:
  RECEIPT — Expense receipts (vendor, amount, date, category)
  STATEMENT — Bank/investment statements (institution, period, balance)
  OTHER — Anything that doesn't match above

FORM RECOGNITION GUIDE (key distinguishing features):
- W-2: Look for "Wage and Tax Statement" header, boxes a-f (SSN, EIN, employer/employee), boxes 1-20
- 1099-NEC: "Nonemployee Compensation" header, single large box 1
- 1099-INT: "Interest Income" header, box 1 interest income
- 1099-DIV: "Dividends and Distributions" header, boxes 1a/1b
- 1099-B: "Proceeds From Broker" header, columns for proceeds/cost basis/gain loss
- 1099-R: "Distributions From Pensions" header, box 7 distribution code is key
- 1099-MISC: "Miscellaneous Income" header (pre-2020 had NEC in box 7)
- 1099-G: "Certain Government Payments" header
- 1099-K: "Payment Card and Third Party" header
- SSA-1099: "Social Security Benefit Statement" — NOT a 1099 series form
- 1098: "Mortgage Interest Statement" from lender
- 1098-T: "Tuition Statement" from educational institution
- Schedule A/C/D/E: "SCHEDULE X" header on Form 1040
- K-1: "Partner's Share of Income" or "Shareholder's Share"
- Form 1065/1120-S/941: Large multi-page business returns

TOOL STRATEGY:
- For images: Start with vision_extract (sees layout). If grade < 0.85, try ocr_extract + extract_fields.
- For PDFs: Start with ocr_extract, then extract_fields.
- If grade shows likely_correct_type=false: Try the suggested type in the next extraction.
- If grade >= ${GOOD_SCORE_THRESHOLD}: Accept the result. You can stop.
- Focus on the grade feedback to decide your next action.

FINISH CONDITIONS:
- Score >= ${GOOD_SCORE_THRESHOLD} → You can accept. Just output your conclusion (no more tool calls).
- likely_correct_type=false → Try the type suggested in the grade.
- Budget exhausted → The system will stop you. Output your final assessment.

ISSUE FORMAT: [SEVERITY:type:expected:detected] Human-readable description
Example: [ERROR:missing_field:employer_name:null] Employer name is required but was not found

FILE NAME: ${fileName}
EXPECTED TAX YEAR: ${expectedTaxYear || 'any'}`
}

// ============================================
// MAIN CLASSIFICATION FUNCTION
// ============================================

export async function classifyDocumentAgentic(
  image: DocumentImage,
  fileName: string,
  expectedTaxYear?: number
): Promise<ClassificationResult> {
  const { base64, mimeType } = image

  if (!base64 || base64.length < 100) {
    console.log(`[CLASSIFIER] Invalid or empty image for ${fileName}`)
    return createFallbackResult('Document image appears to be invalid or empty.')
  }

  const systemPrompt = buildSystemPrompt(fileName, expectedTaxYear)

  const imageMediaType = mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
  const isPDF = mimeType === 'application/pdf'

  const userContent: Anthropic.ContentBlockParam[] = isPDF
    ? [{
        type: 'text',
        text: 'Classify this PDF document. Start with ocr_extract to get the text content, then use extract_fields.'
      }]
    : [
        { type: 'image', source: { type: 'base64', media_type: imageMediaType, data: base64 } },
        { type: 'text', text: 'Classify this document. Start with vision_extract for your best type guess. Use ocr_extract + extract_fields if the grade is low.' }
      ]

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: userContent }
  ]

  const ocrCache: { text: string | null } = { text: null }
  let bestResult: ExtractionAttempt | null = null
  let lastGrade: Grade | null = null
  let extractionCount = 0
  let iterations = 0
  let availableTools = buildTools()

  while (iterations < MAX_ITERATIONS) {
    iterations++

    const response = await anthropic.messages.create({
      model: 'claude-opus-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      tools: availableTools,
      messages
    })

    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
    )

    // Claude stopped without tool calls — it's done reflecting
    if (toolUseBlocks.length === 0) {
      console.log(`[CLASSIFIER] Agent finished after ${iterations} iterations for ${fileName}`)
      break
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = []

    for (const block of toolUseBlocks) {
      const isExtraction = block.name === 'vision_extract' || block.name === 'extract_fields'

      // Build prior feedback from last grade (Level 2 injection)
      let priorFeedback: PriorFeedback | null = null
      if (isExtraction && lastGrade) {
        const fieldsToRecheck = lastGrade.issues
          .map(issue => {
            const match = issue.match(/^\[(?:ERROR|WARNING):missing_field:([^:]*):/)
            return match?.[1]
          })
          .filter((f): f is string => !!f)

        priorFeedback = {
          issues: lastGrade.issues,
          suggestion: lastGrade.suggestion,
          fields_to_recheck: fieldsToRecheck,
          retry_instructions: lastGrade.retry_instructions,
        }
      }

      const { result, attempt } = await executeToolCall(
        block.name, block.input, image, ocrCache, fileName, priorFeedback
      )

      if (attempt) {
        extractionCount++
        lastGrade = attempt.grade

        if (!bestResult || attempt.grade.score > bestResult.grade.score) {
          bestResult = attempt
        }
      }

      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: JSON.stringify(result)
      })
    }

    messages.push({ role: 'assistant', content: response.content })
    messages.push({ role: 'user', content: toolResults })

    // Budget enforcement: strip extraction tools when budget exhausted
    if (extractionCount >= MAX_EXTRACTIONS) {
      console.log(`[CLASSIFIER] Extraction budget exhausted (${extractionCount}/${MAX_EXTRACTIONS})`)
      availableTools = availableTools.filter(t => t.name === 'ocr_extract')
      // If no useful tools left, break to let Claude give final text response
      if (availableTools.length === 0) break
    }
  }

  // Return best result
  if (bestResult) {
    const taxYear = (bestResult.extracted_fields.tax_year as number) ?? null
    console.log(`[CLASSIFIER] Best result: ${bestResult.document_type} (score ${bestResult.grade.score.toFixed(2)}) after ${extractionCount} extractions for ${fileName}`)
    return {
      documentType: bestResult.document_type,
      confidence: bestResult.grade.score,
      taxYear,
      issues: bestResult.grade.issues,
      extractedFields: bestResult.extracted_fields,
      needsHumanReview: bestResult.grade.score < GOOD_SCORE_THRESHOLD,
    }
  }

  console.warn(`[CLASSIFIER] No extraction results for ${fileName} after ${iterations} iterations`)
  return createFallbackResult('Classification completed without any successful extraction')
}

// ============================================
// HELPERS
// ============================================

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
