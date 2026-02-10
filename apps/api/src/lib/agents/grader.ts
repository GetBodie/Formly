/**
 * Grader - Validates extraction quality and provides feedback
 * 
 * The critical piece of the agentic classification loop. Decides whether
 * an extraction is good enough, or generates feedback for retry.
 */

import { FORM_TEMPLATES, GENERIC_TEMPLATE, type FormTemplate, type FormField } from '../form-templates.js'
import type { ExtractionResult, ExtractedField } from './extractor.js'

// ============================================
// TYPES
// ============================================

export interface FieldGradeResult {
  valid: boolean
  issue?: string
}

export interface GradeResult {
  pass: boolean
  score: number                    // 0-100 overall quality score
  documentType: string             // Confirmed or adjusted type
  confidence: number               // Final confidence
  
  // Detailed breakdown
  fieldResults: Record<string, FieldGradeResult>
  
  // If not passing, why and what to try
  failureReasons: string[]
  feedback: string                 // Specific guidance for next attempt
  
  // Final issues to report (even on pass)
  issues: string[]
}

export interface GraderContext {
  extraction: ExtractionResult
  ocrText: string
  fileName: string
  expectedTaxYear?: number
  attemptNumber: number
}

// ============================================
// FORMAT VALIDATORS
// ============================================

export interface FormatValidationResult {
  valid: boolean
  issue?: string
}

/**
 * Validate SSN format: XXX-XX-XXXX or XXXXXXXXX or masked ***-**-XXXX
 */
export function validateSSN(value: string): FormatValidationResult {
  const strValue = String(value).replace(/\s/g, '')
  // Accept XXX-XX-XXXX or XXXXXXXXX or partially masked
  const ssnPattern = /^(\d{3}-?\d{2}-?\d{4}|\*{3,5}-?\*{2}-?\d{4}|X{3}-?X{2}-?\d{4})$/i
  return ssnPattern.test(strValue)
    ? { valid: true }
    : { valid: false, issue: `"${value}" is not a valid SSN format (expected XXX-XX-XXXX)` }
}

/**
 * Validate EIN format: XX-XXXXXXX or XXXXXXXXX
 */
export function validateEIN(value: string): FormatValidationResult {
  const strValue = String(value).replace(/\s/g, '')
  const einPattern = /^\d{2}-?\d{7}$/
  return einPattern.test(strValue)
    ? { valid: true }
    : { valid: false, issue: `"${value}" is not a valid EIN format (expected XX-XXXXXXX)` }
}

/**
 * Validate currency format: $1,234.56 or 1234.56 or 1,234 or negative values
 */
export function validateCurrency(value: string | number): FormatValidationResult {
  const strValue = String(value)
  // Remove currency symbols, commas, and spaces
  const cleanedValue = strValue.replace(/[$,\s]/g, '')
  // Allow negative values, decimals up to 2 places
  const currencyPattern = /^-?\d+(\.\d{0,2})?$/
  return currencyPattern.test(cleanedValue)
    ? { valid: true }
    : { valid: false, issue: `"${value}" is not a valid currency amount` }
}

/**
 * Validate date format
 */
export function validateDate(value: string): FormatValidationResult {
  const date = new Date(value)
  return !isNaN(date.getTime())
    ? { valid: true }
    : { valid: false, issue: `"${value}" is not a valid date` }
}

/**
 * Validate percentage format: 10% or 10.5 or 10.5%
 */
export function validatePercentage(value: string | number): FormatValidationResult {
  const strValue = String(value)
  const pctPattern = /^\d+(\.\d+)?%?$/
  return pctPattern.test(strValue)
    ? { valid: true }
    : { valid: false, issue: `"${value}" is not a valid percentage` }
}

/**
 * Validate a value against its format specification
 */
export function validateFormat(
  value: unknown,
  format?: RegExp | 'currency' | 'ssn' | 'ein' | 'date' | 'percentage'
): FormatValidationResult {
  if (!format) return { valid: true }
  if (value === null || value === undefined || value === '') {
    return { valid: true } // Empty values handled separately by required check
  }
  
  const strValue = String(value)
  
  if (format instanceof RegExp) {
    return format.test(strValue)
      ? { valid: true }
      : { valid: false, issue: `Value "${strValue}" doesn't match expected format` }
  }
  
  switch (format) {
    case 'ssn':
      return validateSSN(strValue)
    case 'ein':
      return validateEIN(strValue)
    case 'currency':
      return validateCurrency(strValue)
    case 'date':
      return validateDate(strValue)
    case 'percentage':
      return validatePercentage(strValue)
    default:
      return { valid: true }
  }
}

// ============================================
// BLANK FORM DETECTION
// ============================================

/**
 * Check if all extracted fields are empty/null
 */
export function isBlankForm(fields: Record<string, ExtractedField>): boolean {
  const fieldValues = Object.values(fields)
  if (fieldValues.length === 0) return true
  
  return fieldValues.every(f => {
    const val = f.value
    return val === null || val === undefined || val === '' || val === 0
  })
}

/**
 * Count how many fields have actual values
 */
export function countFilledFields(fields: Record<string, ExtractedField>): number {
  return Object.values(fields).filter(f => {
    const val = f.value
    return val !== null && val !== undefined && val !== '' && val !== 0
  }).length
}

// ============================================
// CROSS-REFERENCE CHECKS
// ============================================

interface CrossRefIssue {
  severity: 'ERROR' | 'WARNING'
  message: string
}

/**
 * W-2 specific sanity checks
 */
export function crossCheckW2(fields: Record<string, ExtractedField>): CrossRefIssue[] {
  const issues: CrossRefIssue[] = []
  
  const wages = parseFloat(String(fields['wages_tips']?.value || '0').replace(/[$,]/g, '')) || 0
  const ssWages = parseFloat(String(fields['ss_wages']?.value || '0').replace(/[$,]/g, '')) || 0
  const medicareWages = parseFloat(String(fields['medicare_wages']?.value || '0').replace(/[$,]/g, '')) || 0
  const federalWithheld = parseFloat(String(fields['federal_tax_withheld']?.value || '0').replace(/[$,]/g, '')) || 0
  
  // SS wages shouldn't significantly exceed total wages (allow 10% tolerance for edge cases)
  if (ssWages > 0 && wages > 0 && ssWages > wages * 1.1) {
    issues.push({
      severity: 'WARNING',
      message: 'Social security wages exceed total wages - please verify'
    })
  }
  
  // Medicare wages shouldn't significantly exceed total wages
  if (medicareWages > 0 && wages > 0 && medicareWages > wages * 1.1) {
    issues.push({
      severity: 'WARNING',
      message: 'Medicare wages exceed total wages - please verify'
    })
  }
  
  // Federal tax withheld shouldn't exceed total wages
  if (federalWithheld > 0 && wages > 0 && federalWithheld > wages) {
    issues.push({
      severity: 'WARNING',
      message: 'Federal tax withheld exceeds total wages - please verify'
    })
  }
  
  // Wages shouldn't be negative
  if (wages < 0) {
    issues.push({
      severity: 'ERROR',
      message: 'Wages cannot be negative'
    })
  }
  
  return issues
}

/**
 * 1099 specific sanity checks
 */
export function crossCheck1099(fields: Record<string, ExtractedField>, formType: string): CrossRefIssue[] {
  const issues: CrossRefIssue[] = []
  
  // Get the primary income field based on form type
  let primaryField = ''
  switch (formType) {
    case '1099-NEC':
      primaryField = 'nonemployee_compensation'
      break
    case '1099-INT':
      primaryField = 'interest_income'
      break
    case '1099-DIV':
      primaryField = 'total_dividends'
      break
    case '1099-MISC':
      primaryField = 'other_income'
      break
    case '1099-R':
      primaryField = 'gross_distribution'
      break
  }
  
  if (primaryField) {
    const income = parseFloat(String(fields[primaryField]?.value || '0').replace(/[$,]/g, '')) || 0
    const withheld = parseFloat(String(fields['federal_tax_withheld']?.value || '0').replace(/[$,]/g, '')) || 0
    
    // Withheld shouldn't exceed income
    if (withheld > 0 && income > 0 && withheld > income) {
      issues.push({
        severity: 'WARNING',
        message: 'Federal tax withheld exceeds income amount - please verify'
      })
    }
  }
  
  return issues
}

/**
 * Run cross-reference checks based on document type
 */
export function runCrossReferenceChecks(
  documentType: string,
  fields: Record<string, ExtractedField>
): CrossRefIssue[] {
  switch (documentType) {
    case 'W-2':
      return crossCheckW2(fields)
    case '1099-NEC':
    case '1099-INT':
    case '1099-DIV':
    case '1099-MISC':
    case '1099-R':
      return crossCheck1099(fields, documentType)
    default:
      return []
  }
}

// ============================================
// MAIN GRADER FUNCTION
// ============================================

/**
 * Grade an extraction result and determine if it passes quality checks
 */
export async function grade(ctx: GraderContext): Promise<GradeResult> {
  const { extraction, expectedTaxYear, attemptNumber } = ctx
  
  const template = FORM_TEMPLATES[extraction.likelyType] || GENERIC_TEMPLATE
  const fieldResults: Record<string, FieldGradeResult> = {}
  const failureReasons: string[] = []
  const issues: string[] = []
  
  // ============================================
  // RULE 1: Validate field formats
  // ============================================
  for (const fieldDef of template.fields) {
    const extracted = extraction.fields[fieldDef.name]
    
    if (!extracted || extracted.value === null || extracted.value === undefined || extracted.value === '') {
      if (fieldDef.required) {
        fieldResults[fieldDef.name] = {
          valid: false,
          issue: `Required field missing: ${fieldDef.description}`
        }
        failureReasons.push(`Missing ${fieldDef.description} (${fieldDef.location || 'location unknown'})`)
      } else {
        fieldResults[fieldDef.name] = { valid: true } // Optional field, OK to be missing
      }
      continue
    }
    
    // Format validation
    const formatResult = validateFormat(extracted.value, fieldDef.format)
    if (!formatResult.valid) {
      fieldResults[fieldDef.name] = {
        valid: false,
        issue: formatResult.issue
      }
      if (fieldDef.required) {
        failureReasons.push(`${fieldDef.description}: ${formatResult.issue}`)
      }
    } else {
      fieldResults[fieldDef.name] = { valid: true }
    }
  }
  
  // ============================================
  // RULE 2: Check minimum required fields
  // ============================================
  const requiredFields = template.fields.filter(f => f.required)
  const filledRequiredFields = requiredFields.filter(f => {
    const extracted = extraction.fields[f.name]
    return extracted && 
           extracted.value !== null && 
           extracted.value !== undefined && 
           extracted.value !== '' &&
           fieldResults[f.name]?.valid !== false
  })
  
  const requiredFieldRatio = requiredFields.length > 0 
    ? filledRequiredFields.length / requiredFields.length 
    : 1
  
  if (filledRequiredFields.length < template.minRequiredFields) {
    failureReasons.push(
      `Only ${filledRequiredFields.length}/${template.minRequiredFields} minimum required fields found`
    )
  }
  
  // ============================================
  // RULE 3: Detect blank/template forms
  // ============================================
  const allFieldsNull = isBlankForm(extraction.fields)
  
  if (allFieldsNull) {
    failureReasons.push('Document appears to be a blank template with no filled values')
    issues.push('[ERROR:incomplete::] Document appears to be a blank form template. Please upload a completed form with actual data.')
  }
  
  // ============================================
  // RULE 4: Tax year validation
  // ============================================
  const extractedYear = extraction.fields['tax_year']?.value
  if (expectedTaxYear && extractedYear) {
    const yearNum = Number(extractedYear)
    if (yearNum !== expectedTaxYear) {
      issues.push(`[ERROR:wrong_year:${expectedTaxYear}:${extractedYear}] Document is for tax year ${extractedYear}, but we need ${expectedTaxYear}`)
    }
  } else if (expectedTaxYear && !extractedYear) {
    issues.push(`[WARNING:missing_field:tax_year:] Could not determine tax year from document`)
  }
  
  // ============================================
  // RULE 5: Cross-reference sanity checks
  // ============================================
  const crossRefIssues = runCrossReferenceChecks(extraction.likelyType, extraction.fields)
  for (const issue of crossRefIssues) {
    issues.push(`[${issue.severity}:inconsistent::] ${issue.message}`)
  }
  
  // ============================================
  // RULE 6: Confidence threshold check
  // ============================================
  const meetsConfidenceThreshold = extraction.overallConfidence >= template.confidenceThreshold
  if (!meetsConfidenceThreshold) {
    failureReasons.push(
      `Confidence ${(extraction.overallConfidence * 100).toFixed(0)}% below threshold ${(template.confidenceThreshold * 100).toFixed(0)}%`
    )
  }
  
  // ============================================
  // CALCULATE FINAL SCORE
  // ============================================
  let score = 0
  
  // Field completeness (40 points)
  score += requiredFieldRatio * 40
  
  // Format validity (30 points)
  const validFieldCount = Object.values(fieldResults).filter(r => r.valid).length
  const totalFieldCount = Object.values(fieldResults).length
  const validFieldRatio = totalFieldCount > 0 ? validFieldCount / totalFieldCount : 0
  score += validFieldRatio * 30
  
  // Confidence alignment (20 points)
  score += extraction.overallConfidence * 20
  
  // No critical issues (10 points)
  const hasCriticalIssues = issues.some(i => i.startsWith('[ERROR'))
  if (!hasCriticalIssues) score += 10
  
  // ============================================
  // GENERATE FEEDBACK FOR NEXT ATTEMPT
  // ============================================
  let feedback = ''
  if (failureReasons.length > 0) {
    feedback = `Issues found:\n${failureReasons.map(r => `- ${r}`).join('\n')}\n\n`
    
    // Add specific guidance based on what's missing
    const missingFields = template.fields.filter(f => {
      const extracted = extraction.fields[f.name]
      return f.required && (!extracted || extracted.value === null || extracted.value === undefined || extracted.value === '')
    })
    
    if (missingFields.length > 0) {
      feedback += `Please look more carefully for:\n`
      for (const field of missingFields) {
        feedback += `- ${field.description}: typically found in ${field.location || 'the document'}\n`
      }
    }
    
    // Escalating strategies based on attempt number
    if (attemptNumber === 2) {
      feedback += `\nTry alternative interpretation: Could this be a different form type? Check: ${extraction.alternativeTypes.join(', ')}`
    } else if (attemptNumber >= 3) {
      feedback += `\nFinal attempt: Focus only on the most critical fields. If still unclear, report as OTHER with low confidence.`
    }
  }
  
  // ============================================
  // FINAL DECISION
  // ============================================
  const pass = failureReasons.length === 0 ||
               (score >= 70 && meetsConfidenceThreshold && !allFieldsNull)
  
  return {
    pass,
    score: Math.round(score),
    documentType: pass ? extraction.likelyType : (allFieldsNull ? 'OTHER' : extraction.likelyType),
    confidence: pass ? extraction.overallConfidence : Math.min(extraction.overallConfidence, 0.5),
    fieldResults,
    failureReasons,
    feedback,
    issues
  }
}

export default { grade, validateFormat, isBlankForm, countFilledFields }
