/**
 * Extractor - LLM-based field extraction with structured output
 * 
 * Given OCR text and optional feedback, tries to identify the document
 * type and fill as many fields as possible from the form templates.
 */

import OpenAI from 'openai'
import { zodResponseFormat } from 'openai/helpers/zod'
import { z } from 'zod'
import { getKnownDocumentTypes } from '../form-templates.js'

const openai = new OpenAI()
const MODEL = 'gpt-4o-2024-08-06'

// ============================================
// TYPES & SCHEMAS
// ============================================

export interface ExtractedField {
  value: string | number | null
  confidence: number       // 0-1 for this specific field
  rawText?: string        // The original text snippet
}

export interface ExtractionResult {
  likelyType: string           // Best guess at document type
  alternativeTypes: string[]   // Other possibilities
  fields: Record<string, ExtractedField>
  overallConfidence: number
  reasoning: string            // Why this classification
}

// Zod schema for LLM structured output
const ExtractedFieldSchema = z.object({
  value: z.union([z.string(), z.number(), z.null()]),
  confidence: z.number().min(0).max(1),
  rawText: z.string().optional()
})

const ExtractionResultSchema = z.object({
  likelyType: z.string(),
  alternativeTypes: z.array(z.string()),
  fields: z.record(z.string(), ExtractedFieldSchema),
  overallConfidence: z.number().min(0).max(1),
  reasoning: z.string()
})

// ============================================
// SYSTEM PROMPT
// ============================================

const EXTRACTOR_SYSTEM_PROMPT = `You are a tax document field extractor. Your job is to:

1. Identify the document type from this list: ${getKnownDocumentTypes().join(', ')}, RECEIPT, STATEMENT, or OTHER
2. Extract all visible field values into structured data
3. Report confidence for each extraction

IMPORTANT RULES:
- Only extract values you can actually see in the text
- If a field is blank, cut off, or illegible, set value to null
- Don't hallucinate or guess values that aren't visible
- A blank form template (no filled values) should be classified as OTHER with low confidence
- Look for specific patterns: SSN (XXX-XX-XXXX), EIN (XX-XXXXXXX), currency ($X,XXX.XX)

FIELD NAMES TO EXTRACT (use these exact names):
For W-2: employee_ssn, employer_ein, employer_name, employee_name, wages_tips, federal_tax_withheld, ss_wages, ss_tax_withheld, medicare_wages, medicare_tax_withheld, tax_year
For 1099-NEC: payer_tin, payer_name, recipient_tin, recipient_name, nonemployee_compensation, federal_tax_withheld, tax_year
For 1099-INT: payer_tin, payer_name, recipient_tin, recipient_name, interest_income, early_withdrawal_penalty, interest_on_savings_bonds, federal_tax_withheld, tax_year
For 1099-DIV: payer_tin, payer_name, recipient_tin, recipient_name, total_dividends, qualified_dividends, capital_gain_distributions, federal_tax_withheld, tax_year
For 1099-MISC: payer_tin, payer_name, recipient_tin, recipient_name, rents, royalties, other_income, federal_tax_withheld, fishing_boat_proceeds, medical_payments, tax_year
For K-1: partnership_ein, partnership_name, partner_tin, partner_name, ordinary_income, net_rental_income, other_net_rental_income, guaranteed_payments, interest_income, dividends, tax_year
For 1099-B: payer_tin, payer_name, recipient_tin, proceeds, cost_basis, tax_year
For 1099-R: payer_tin, payer_name, recipient_tin, gross_distribution, taxable_amount, federal_tax_withheld, distribution_code, tax_year
For OTHER: document_title, tax_year, issuer_name, recipient_name, any_amounts

For each field, report:
- value: The extracted value (null if not found, use string for SSN/EIN, number for currency)
- confidence: 0-1 how sure you are this is correct
- rawText: The exact text snippet you extracted from (for verification)

Think step by step:
1. What type of document does this appear to be?
2. What fields can I definitively see filled in?
3. Are there any fields I'm uncertain about?

Response format (FOLLOW EXACTLY):
{
  "likelyType": "W-2",
  "alternativeTypes": ["1099-MISC"],
  "fields": {
    "employee_ssn": { "value": "123-45-6789", "confidence": 0.95, "rawText": "SSN: 123-45-6789" },
    "wages_tips": { "value": 50000, "confidence": 0.9, "rawText": "Box 1: $50,000.00" }
  },
  "overallConfidence": 0.85,
  "reasoning": "Document header shows 'Form W-2' and contains typical W-2 fields..."
}`

// ============================================
// EXTRACTION FUNCTION
// ============================================

/**
 * Extract fields from OCR text using LLM
 */
export async function extract(
  ocrText: string,
  fileName: string,
  feedback?: string,
  expectedTaxYear?: number
): Promise<ExtractionResult> {
  // Build user prompt
  let userPrompt = ''
  
  if (feedback) {
    userPrompt = `PREVIOUS ATTEMPT FEEDBACK:\n${feedback}\n\nPlease try again with this guidance.\n\n`
  }
  
  userPrompt += `File: ${fileName}\n`
  
  if (expectedTaxYear) {
    userPrompt += `Expected tax year: ${expectedTaxYear}\n`
  }
  
  userPrompt += `\nOCR Text:\n${ocrText.slice(0, 15000)}` // Limit to 15k chars for context
  
  try {
    const response = await openai.chat.completions.parse({
      model: MODEL,
      messages: [
        { role: 'system', content: EXTRACTOR_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt }
      ],
      response_format: zodResponseFormat(ExtractionResultSchema, 'extraction'),
      temperature: 0
    })
    
    const parsed = response.choices[0]?.message?.parsed
    
    if (!parsed) {
      throw new Error('Extraction returned empty response')
    }
    
    return parsed
  } catch (error) {
    console.error('[EXTRACTOR] LLM extraction failed:', error)
    
    // Return a minimal fallback result
    return {
      likelyType: 'OTHER',
      alternativeTypes: [],
      fields: {},
      overallConfidence: 0.1,
      reasoning: `Extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    }
  }
}

/**
 * Quick pre-check for minimal/empty content
 * Returns true if content is too short to be a valid document
 */
export function isMinimalContent(ocrText: string): boolean {
  const trimmed = ocrText.trim()
  return trimmed.length < 100
}

/**
 * Quick detection of likely form type from filename and keywords
 * Used for early hints to the extractor
 */
export function detectLikelyTypeFromFilename(fileName: string): string | null {
  const name = fileName.toLowerCase()
  
  if (name.includes('w-2') || name.includes('w2')) return 'W-2'
  if (name.includes('1099-nec') || name.includes('1099nec')) return '1099-NEC'
  if (name.includes('1099-int') || name.includes('1099int')) return '1099-INT'
  if (name.includes('1099-div') || name.includes('1099div')) return '1099-DIV'
  if (name.includes('1099-misc') || name.includes('1099misc')) return '1099-MISC'
  if (name.includes('1099-b') || name.includes('1099b')) return '1099-B'
  if (name.includes('1099-r') || name.includes('1099r')) return '1099-R'
  if (name.includes('k-1') || name.includes('k1') || name.includes('schedule-k')) return 'K-1'
  if (name.includes('receipt')) return 'RECEIPT'
  if (name.includes('statement')) return 'STATEMENT'
  
  return null
}

export default { extract, isMinimalContent, detectLikelyTypeFromFilename }
