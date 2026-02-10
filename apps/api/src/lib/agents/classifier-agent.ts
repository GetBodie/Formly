/**
 * Classifier Agent - Agentic document classification loop
 * 
 * Orchestrates the extract → grade → feedback loop for reliable
 * document classification with up to 3 attempts.
 */

import { extract, isMinimalContent, type ExtractionResult } from './extractor.js'
import { grade, type GradeResult } from './grader.js'

// ============================================
// TYPES
// ============================================

export interface ClassificationResult {
  documentType: string
  confidence: number
  taxYear: number | null
  issues: string[]
  extractedFields: Record<string, unknown>  // Structured data from extraction
  attempts: number
}

// ============================================
// CONSTANTS
// ============================================

const MAX_ATTEMPTS = 3

// ============================================
// MAIN CLASSIFICATION FUNCTION
// ============================================

/**
 * Classify a document using an agentic loop:
 * 1. Extract fields from OCR text
 * 2. Grade the extraction quality
 * 3. If not passing, generate feedback and retry
 * 4. Return best result after max attempts
 */
export async function classifyDocumentAgentic(
  ocrText: string,
  fileName: string,
  expectedTaxYear?: number
): Promise<ClassificationResult> {
  // Pre-check: Very minimal content = return early with low confidence
  if (isMinimalContent(ocrText)) {
    console.log(`[CLASSIFIER-AGENT] Minimal content detected (${ocrText.trim().length} chars) for ${fileName}`)
    return {
      documentType: 'OTHER',
      confidence: 0.3,
      taxYear: null,
      issues: ['[WARNING:incomplete::] Document appears to be blank or has minimal content. Please upload a completed form with filled-in data.'],
      extractedFields: {},
      attempts: 0
    }
  }
  
  let feedback: string | undefined
  let lastExtraction: ExtractionResult | null = null
  let lastGrade: GradeResult | null = null
  
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    console.log(`[CLASSIFIER-AGENT] Attempt ${attempt}/${MAX_ATTEMPTS} for ${fileName}`)
    
    // Step 1: Extract fields from OCR text
    const extraction = await extract(ocrText, fileName, feedback, expectedTaxYear)
    lastExtraction = extraction
    
    console.log(`[CLASSIFIER-AGENT] Extracted as ${extraction.likelyType} (${(extraction.overallConfidence * 100).toFixed(0)}% confidence)`)
    
    // Step 2: Grade the extraction quality
    const gradeResult = await grade({
      extraction,
      ocrText,
      fileName,
      expectedTaxYear,
      attemptNumber: attempt
    })
    lastGrade = gradeResult
    
    console.log(`[CLASSIFIER-AGENT] Grade: ${gradeResult.pass ? 'PASS' : 'FAIL'} (score: ${gradeResult.score})`)
    
    // Step 3: Check if we're done
    if (gradeResult.pass) {
      console.log(`[CLASSIFIER-AGENT] Classification succeeded on attempt ${attempt}`)
      
      return {
        documentType: gradeResult.documentType,
        confidence: gradeResult.confidence,
        taxYear: parseNullableYear(extraction.fields['tax_year']?.value),
        issues: gradeResult.issues,
        extractedFields: extractFieldValues(extraction.fields),
        attempts: attempt
      }
    }
    
    // Step 4: Prepare feedback for next attempt
    feedback = gradeResult.feedback
    
    if (attempt < MAX_ATTEMPTS) {
      console.log(`[CLASSIFIER-AGENT] Retrying with feedback: ${feedback.slice(0, 200)}...`)
    }
  }
  
  // Exhausted all attempts - return best effort with low confidence
  console.log(`[CLASSIFIER-AGENT] Max attempts (${MAX_ATTEMPTS}) reached for ${fileName}`)
  
  // Add a low confidence warning to issues
  const finalIssues = [
    ...(lastGrade?.issues || []),
    '[WARNING:low_confidence::] Document could not be confidently classified after multiple attempts. Manual review recommended.'
  ]
  
  return {
    documentType: lastGrade?.documentType || 'OTHER',
    confidence: Math.min(lastExtraction?.overallConfidence || 0.3, 0.5),
    taxYear: parseNullableYear(lastExtraction?.fields['tax_year']?.value),
    issues: finalIssues,
    extractedFields: lastExtraction ? extractFieldValues(lastExtraction.fields) : {},
    attempts: MAX_ATTEMPTS
  }
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Parse a year value to number or null
 */
function parseNullableYear(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const num = Number(value)
  if (isNaN(num)) return null
  // Validate it looks like a reasonable tax year (2000-2099)
  if (num >= 2000 && num <= 2099) return num
  return null
}

/**
 * Extract just the values from the field results
 */
function extractFieldValues(
  fields: Record<string, { value: string | number | null; confidence: number; rawText?: string }>
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  
  for (const [key, field] of Object.entries(fields)) {
    if (field.value !== null && field.value !== undefined && field.value !== '') {
      result[key] = field.value
    }
  }
  
  return result
}

// ============================================
// EXPORTS
// ============================================

export default { classifyDocumentAgentic }
