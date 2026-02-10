/**
 * Unit tests for the Grader module
 * Tests format validators, blank form detection, cross-reference checks, and grading logic
 */

import { describe, it, expect } from 'vitest'
import {
  validateSSN,
  validateEIN,
  validateCurrency,
  validateDate,
  validatePercentage,
  validateFormat,
  isBlankForm,
  countFilledFields,
  crossCheckW2,
  crossCheck1099,
  grade,
  type GraderContext
} from '../grader.js'
import type { ExtractionResult, ExtractedField } from '../extractor.js'

// ============================================
// FORMAT VALIDATORS
// ============================================

describe('Format Validators', () => {
  describe('validateSSN', () => {
    it('should accept valid SSN with dashes', () => {
      expect(validateSSN('123-45-6789').valid).toBe(true)
    })

    it('should accept valid SSN without dashes', () => {
      expect(validateSSN('123456789').valid).toBe(true)
    })

    it('should accept masked SSN', () => {
      expect(validateSSN('***-**-6789').valid).toBe(true)
      expect(validateSSN('XXX-XX-6789').valid).toBe(true)
    })

    it('should reject invalid SSN', () => {
      expect(validateSSN('123-45-678').valid).toBe(false)
      expect(validateSSN('12-345-6789').valid).toBe(false)
      expect(validateSSN('abc-de-fghi').valid).toBe(false)
    })
  })

  describe('validateEIN', () => {
    it('should accept valid EIN with dash', () => {
      expect(validateEIN('12-3456789').valid).toBe(true)
    })

    it('should accept valid EIN without dash', () => {
      expect(validateEIN('123456789').valid).toBe(true)
    })

    it('should reject invalid EIN', () => {
      expect(validateEIN('1-23456789').valid).toBe(false)
      expect(validateEIN('123-456789').valid).toBe(false)
      expect(validateEIN('12345678').valid).toBe(false)
    })
  })

  describe('validateCurrency', () => {
    it('should accept positive currency amounts', () => {
      expect(validateCurrency('1234.56').valid).toBe(true)
      expect(validateCurrency('$1,234.56').valid).toBe(true)
      expect(validateCurrency('1234').valid).toBe(true)
      expect(validateCurrency(50000).valid).toBe(true)
    })

    it('should accept negative currency amounts', () => {
      expect(validateCurrency('-1234.56').valid).toBe(true)
    })

    it('should accept zero', () => {
      expect(validateCurrency('0').valid).toBe(true)
      expect(validateCurrency(0).valid).toBe(true)
    })

    it('should reject invalid currency', () => {
      expect(validateCurrency('abc').valid).toBe(false)
      expect(validateCurrency('1234.567').valid).toBe(false)
    })
  })

  describe('validateDate', () => {
    it('should accept valid dates', () => {
      expect(validateDate('2024-01-15').valid).toBe(true)
      expect(validateDate('January 15, 2024').valid).toBe(true)
    })

    it('should reject invalid dates', () => {
      expect(validateDate('not a date').valid).toBe(false)
    })
  })

  describe('validatePercentage', () => {
    it('should accept valid percentages', () => {
      expect(validatePercentage('10%').valid).toBe(true)
      expect(validatePercentage('10.5%').valid).toBe(true)
      expect(validatePercentage('10.5').valid).toBe(true)
      expect(validatePercentage(25).valid).toBe(true)
    })

    it('should reject invalid percentages', () => {
      expect(validatePercentage('-10%').valid).toBe(false)
      expect(validatePercentage('abc%').valid).toBe(false)
    })
  })

  describe('validateFormat (generic)', () => {
    it('should accept any value when no format specified', () => {
      expect(validateFormat('anything').valid).toBe(true)
    })

    it('should validate against regex', () => {
      const yearRegex = /^20\d{2}$/
      expect(validateFormat('2024', yearRegex).valid).toBe(true)
      expect(validateFormat('1999', yearRegex).valid).toBe(false)
    })

    it('should handle null/empty values gracefully', () => {
      expect(validateFormat(null, 'ssn').valid).toBe(true)
      expect(validateFormat('', 'ssn').valid).toBe(true)
    })
  })
})

// ============================================
// BLANK FORM DETECTION
// ============================================

describe('Blank Form Detection', () => {
  describe('isBlankForm', () => {
    it('should detect empty fields object as blank', () => {
      expect(isBlankForm({})).toBe(true)
    })

    it('should detect all-null fields as blank', () => {
      const fields: Record<string, ExtractedField> = {
        field1: { value: null, confidence: 0 },
        field2: { value: null, confidence: 0 },
      }
      expect(isBlankForm(fields)).toBe(true)
    })

    it('should detect all-empty strings as blank', () => {
      const fields: Record<string, ExtractedField> = {
        field1: { value: '', confidence: 0 },
        field2: { value: '', confidence: 0 },
      }
      expect(isBlankForm(fields)).toBe(true)
    })

    it('should detect all-zero numbers as blank', () => {
      const fields: Record<string, ExtractedField> = {
        field1: { value: 0, confidence: 0 },
        field2: { value: 0, confidence: 0 },
      }
      expect(isBlankForm(fields)).toBe(true)
    })

    it('should NOT detect form with values as blank', () => {
      const fields: Record<string, ExtractedField> = {
        field1: { value: '123-45-6789', confidence: 0.9 },
        field2: { value: null, confidence: 0 },
      }
      expect(isBlankForm(fields)).toBe(false)
    })
  })

  describe('countFilledFields', () => {
    it('should count fields with actual values', () => {
      const fields: Record<string, ExtractedField> = {
        field1: { value: '123-45-6789', confidence: 0.9 },
        field2: { value: null, confidence: 0 },
        field3: { value: 50000, confidence: 0.8 },
        field4: { value: '', confidence: 0 },
      }
      expect(countFilledFields(fields)).toBe(2)
    })

    it('should return 0 for empty fields', () => {
      expect(countFilledFields({})).toBe(0)
    })
  })
})

// ============================================
// CROSS-REFERENCE CHECKS
// ============================================

describe('Cross-Reference Checks', () => {
  describe('crossCheckW2', () => {
    it('should pass valid W-2 data', () => {
      const fields: Record<string, ExtractedField> = {
        wages_tips: { value: 50000, confidence: 0.9 },
        ss_wages: { value: 50000, confidence: 0.9 },
        medicare_wages: { value: 50000, confidence: 0.9 },
        federal_tax_withheld: { value: 5000, confidence: 0.9 },
      }
      const issues = crossCheckW2(fields)
      expect(issues.length).toBe(0)
    })

    it('should flag SS wages exceeding total wages', () => {
      const fields: Record<string, ExtractedField> = {
        wages_tips: { value: 50000, confidence: 0.9 },
        ss_wages: { value: 60000, confidence: 0.9 }, // More than 110% of wages
      }
      const issues = crossCheckW2(fields)
      expect(issues.some(i => i.message.includes('Social security wages exceed'))).toBe(true)
    })

    it('should flag federal tax withheld exceeding wages', () => {
      const fields: Record<string, ExtractedField> = {
        wages_tips: { value: 50000, confidence: 0.9 },
        federal_tax_withheld: { value: 60000, confidence: 0.9 },
      }
      const issues = crossCheckW2(fields)
      expect(issues.some(i => i.message.includes('Federal tax withheld exceeds'))).toBe(true)
    })

    it('should flag negative wages', () => {
      const fields: Record<string, ExtractedField> = {
        wages_tips: { value: -5000, confidence: 0.9 },
      }
      const issues = crossCheckW2(fields)
      expect(issues.some(i => i.message.includes('Wages cannot be negative'))).toBe(true)
    })

    it('should handle currency formatted values', () => {
      const fields: Record<string, ExtractedField> = {
        wages_tips: { value: '$50,000.00', confidence: 0.9 },
        federal_tax_withheld: { value: '$5,000.00', confidence: 0.9 },
      }
      const issues = crossCheckW2(fields)
      expect(issues.length).toBe(0)
    })
  })

  describe('crossCheck1099', () => {
    it('should pass valid 1099-NEC data', () => {
      const fields: Record<string, ExtractedField> = {
        nonemployee_compensation: { value: 25000, confidence: 0.9 },
        federal_tax_withheld: { value: 2500, confidence: 0.9 },
      }
      const issues = crossCheck1099(fields, '1099-NEC')
      expect(issues.length).toBe(0)
    })

    it('should flag withheld exceeding income', () => {
      const fields: Record<string, ExtractedField> = {
        nonemployee_compensation: { value: 25000, confidence: 0.9 },
        federal_tax_withheld: { value: 30000, confidence: 0.9 },
      }
      const issues = crossCheck1099(fields, '1099-NEC')
      expect(issues.some(i => i.message.includes('Federal tax withheld exceeds income'))).toBe(true)
    })
  })
})

// ============================================
// GRADER INTEGRATION
// ============================================

describe('Grade Function', () => {
  const createMockExtraction = (overrides: Partial<ExtractionResult> = {}): ExtractionResult => ({
    likelyType: 'W-2',
    alternativeTypes: ['1099-MISC'],
    fields: {
      employee_ssn: { value: '123-45-6789', confidence: 0.95 },
      employer_ein: { value: '12-3456789', confidence: 0.9 },
      employer_name: { value: 'ACME Corporation', confidence: 0.95 },
      wages_tips: { value: 75000, confidence: 0.9 },
      federal_tax_withheld: { value: 8500, confidence: 0.9 },
      tax_year: { value: '2024', confidence: 0.95 },
    },
    overallConfidence: 0.85,
    reasoning: 'Test extraction',
    ...overrides,
  })

  const createMockContext = (extraction: ExtractionResult, overrides: Partial<GraderContext> = {}): GraderContext => ({
    extraction,
    ocrText: 'Sample OCR text',
    fileName: 'test-w2.pdf',
    expectedTaxYear: 2024,
    attemptNumber: 1,
    ...overrides,
  })

  it('should pass a valid W-2 extraction', async () => {
    const extraction = createMockExtraction()
    const context = createMockContext(extraction)
    
    const result = await grade(context)
    
    expect(result.pass).toBe(true)
    expect(result.documentType).toBe('W-2')
    expect(result.confidence).toBeGreaterThanOrEqual(0.8)
    expect(result.issues.length).toBe(0)
  })

  it('should fail a blank form', async () => {
    const extraction = createMockExtraction({
      fields: {
        employee_ssn: { value: null, confidence: 0 },
        employer_ein: { value: null, confidence: 0 },
        wages_tips: { value: null, confidence: 0 },
      },
      overallConfidence: 0.3,
    })
    const context = createMockContext(extraction)
    
    const result = await grade(context)
    
    expect(result.pass).toBe(false)
    expect(result.issues.some(i => i.includes('blank form template'))).toBe(true)
  })

  it('should flag wrong tax year', async () => {
    const extraction = createMockExtraction({
      fields: {
        ...createMockExtraction().fields,
        tax_year: { value: '2023', confidence: 0.95 },
      },
    })
    const context = createMockContext(extraction, { expectedTaxYear: 2024 })
    
    const result = await grade(context)
    
    expect(result.issues.some(i => i.includes('wrong_year'))).toBe(true)
  })

  it('should flag missing required fields', async () => {
    const extraction = createMockExtraction({
      fields: {
        employee_ssn: { value: '123-45-6789', confidence: 0.95 },
        // Missing employer_ein, employer_name, wages_tips, etc.
      },
    })
    const context = createMockContext(extraction)
    
    const result = await grade(context)
    
    expect(result.failureReasons.some(r => r.includes('Missing'))).toBe(true)
  })

  it('should flag invalid field formats', async () => {
    const extraction = createMockExtraction({
      fields: {
        ...createMockExtraction().fields,
        employee_ssn: { value: 'invalid-ssn', confidence: 0.5 },
      },
    })
    const context = createMockContext(extraction)
    
    const result = await grade(context)
    
    expect(result.fieldResults['employee_ssn']?.valid).toBe(false)
  })

  it('should generate feedback with escalating strategies', async () => {
    const extraction = createMockExtraction({
      fields: {
        employee_ssn: { value: null, confidence: 0 },
      },
      overallConfidence: 0.4,
    })
    
    // Attempt 2 should suggest alternative types
    const context2 = createMockContext(extraction, { attemptNumber: 2 })
    const result2 = await grade(context2)
    expect(result2.feedback).toContain('alternative interpretation')
    
    // Attempt 3 should suggest focusing on critical fields
    const context3 = createMockContext(extraction, { attemptNumber: 3 })
    const result3 = await grade(context3)
    expect(result3.feedback).toContain('Final attempt')
  })

  it('should calculate score correctly', async () => {
    const extraction = createMockExtraction()
    const context = createMockContext(extraction)
    
    const result = await grade(context)
    
    // Score should be 0-100
    expect(result.score).toBeGreaterThanOrEqual(0)
    expect(result.score).toBeLessThanOrEqual(100)
  })
})

// ============================================
// EDGE CASES
// ============================================

describe('Edge Cases', () => {
  it('should handle unknown document types gracefully', async () => {
    const extraction: ExtractionResult = {
      likelyType: 'UNKNOWN_TYPE',
      alternativeTypes: [],
      fields: {},
      overallConfidence: 0.3,
      reasoning: 'Unknown document',
    }
    const context: GraderContext = {
      extraction,
      ocrText: 'Random text',
      fileName: 'mystery.pdf',
      attemptNumber: 1,
    }
    
    const result = await grade(context)
    
    // Should use GENERIC_TEMPLATE and return a result
    expect(result).toBeDefined()
    expect(result.score).toBeGreaterThanOrEqual(0)
  })

  it('should handle extremely long field values', async () => {
    const longValue = 'A'.repeat(10000)
    const fields: Record<string, ExtractedField> = {
      employer_name: { value: longValue, confidence: 0.5 },
    }
    
    expect(() => countFilledFields(fields)).not.toThrow()
    expect(countFilledFields(fields)).toBe(1)
  })
})
