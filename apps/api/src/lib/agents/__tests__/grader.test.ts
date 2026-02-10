/**
 * Unit tests for the Grader utilities
 * Tests format validators and utility functions
 * 
 * Note: The actual PASS/FAIL grading is now done by Claude LLM.
 * These tests cover the deterministic format validation helpers.
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
  parseCurrency,
} from '../grader.js'

// ============================================
// SSN VALIDATION
// ============================================

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

  it('should reject invalid SSN - wrong length', () => {
    expect(validateSSN('123-45-678').valid).toBe(false)
    expect(validateSSN('12-345-6789').valid).toBe(false)
  })

  it('should reject invalid SSN - letters', () => {
    expect(validateSSN('abc-de-fghi').valid).toBe(false)
  })

  it('should handle whitespace', () => {
    expect(validateSSN(' 123-45-6789 ').valid).toBe(true)
  })
})

// ============================================
// EIN VALIDATION
// ============================================

describe('validateEIN', () => {
  it('should accept valid EIN with dash', () => {
    expect(validateEIN('12-3456789').valid).toBe(true)
  })

  it('should accept valid EIN without dash', () => {
    expect(validateEIN('123456789').valid).toBe(true)
  })

  it('should reject invalid EIN - wrong dash position', () => {
    expect(validateEIN('1-23456789').valid).toBe(false)
    expect(validateEIN('123-456789').valid).toBe(false)
  })

  it('should reject invalid EIN - wrong length', () => {
    expect(validateEIN('12345678').valid).toBe(false)
    expect(validateEIN('1234567890').valid).toBe(false)
  })
})

// ============================================
// CURRENCY VALIDATION
// ============================================

describe('validateCurrency', () => {
  it('should accept positive amounts', () => {
    expect(validateCurrency('1234.56').valid).toBe(true)
    expect(validateCurrency('$1,234.56').valid).toBe(true)
    expect(validateCurrency('1234').valid).toBe(true)
    expect(validateCurrency(50000).valid).toBe(true)
  })

  it('should accept negative amounts', () => {
    expect(validateCurrency('-1234.56').valid).toBe(true)
    expect(validateCurrency('-$1,234.56').valid).toBe(true)
  })

  it('should accept zero', () => {
    expect(validateCurrency('0').valid).toBe(true)
    expect(validateCurrency(0).valid).toBe(true)
    expect(validateCurrency('$0.00').valid).toBe(true)
  })

  it('should accept amounts with commas', () => {
    expect(validateCurrency('1,000,000.00').valid).toBe(true)
    expect(validateCurrency('$1,000,000').valid).toBe(true)
  })

  it('should reject invalid currency', () => {
    expect(validateCurrency('abc').valid).toBe(false)
    expect(validateCurrency('1234.567').valid).toBe(false) // Too many decimals
    expect(validateCurrency('$abc').valid).toBe(false)
  })
})

// ============================================
// DATE VALIDATION
// ============================================

describe('validateDate', () => {
  it('should accept valid ISO dates', () => {
    expect(validateDate('2024-01-15').valid).toBe(true)
    expect(validateDate('2024-12-31').valid).toBe(true)
  })

  it('should accept human-readable dates', () => {
    expect(validateDate('January 15, 2024').valid).toBe(true)
    expect(validateDate('Jan 15, 2024').valid).toBe(true)
  })

  it('should reject invalid dates', () => {
    expect(validateDate('not a date').valid).toBe(false)
    expect(validateDate('13/45/2024').valid).toBe(false)
  })
})

// ============================================
// PERCENTAGE VALIDATION
// ============================================

describe('validatePercentage', () => {
  it('should accept valid percentages', () => {
    expect(validatePercentage('10%').valid).toBe(true)
    expect(validatePercentage('10.5%').valid).toBe(true)
    expect(validatePercentage('10.5').valid).toBe(true)
    expect(validatePercentage(25).valid).toBe(true)
  })

  it('should accept zero percent', () => {
    expect(validatePercentage('0%').valid).toBe(true)
    expect(validatePercentage('0').valid).toBe(true)
  })

  it('should reject negative percentages', () => {
    expect(validatePercentage('-10%').valid).toBe(false)
  })

  it('should reject invalid percentages', () => {
    expect(validatePercentage('abc%').valid).toBe(false)
  })
})

// ============================================
// GENERIC FORMAT VALIDATION
// ============================================

describe('validateFormat', () => {
  it('should accept any value when no format specified', () => {
    expect(validateFormat('anything').valid).toBe(true)
    expect(validateFormat(12345).valid).toBe(true)
  })

  it('should validate against regex', () => {
    const yearRegex = /^20\d{2}$/
    expect(validateFormat('2024', yearRegex).valid).toBe(true)
    expect(validateFormat('2025', yearRegex).valid).toBe(true)
    expect(validateFormat('1999', yearRegex).valid).toBe(false)
    expect(validateFormat('abcd', yearRegex).valid).toBe(false)
  })

  it('should handle null/empty values gracefully', () => {
    expect(validateFormat(null, 'ssn').valid).toBe(true)
    expect(validateFormat('', 'ssn').valid).toBe(true)
    expect(validateFormat(undefined, 'ein').valid).toBe(true)
  })

  it('should route to specific validators', () => {
    expect(validateFormat('123-45-6789', 'ssn').valid).toBe(true)
    expect(validateFormat('12-3456789', 'ein').valid).toBe(true)
    expect(validateFormat('$1,234.56', 'currency').valid).toBe(true)
    expect(validateFormat('2024-01-15', 'date').valid).toBe(true)
    expect(validateFormat('10%', 'percentage').valid).toBe(true)
  })

  it('should return issues for invalid formats', () => {
    const result = validateFormat('invalid', 'ssn')
    expect(result.valid).toBe(false)
    expect(result.issue).toBeDefined()
    expect(result.issue).toContain('SSN')
  })
})

// ============================================
// UTILITY FUNCTIONS
// ============================================

describe('isBlankForm', () => {
  it('should detect empty fields object as blank', () => {
    expect(isBlankForm({})).toBe(true)
  })

  it('should detect all-null fields as blank', () => {
    expect(isBlankForm({ field1: null, field2: null })).toBe(true)
  })

  it('should detect all-empty strings as blank', () => {
    expect(isBlankForm({ field1: '', field2: '' })).toBe(true)
  })

  it('should detect all-zero numbers as blank', () => {
    expect(isBlankForm({ field1: 0, field2: 0 })).toBe(true)
  })

  it('should NOT detect form with actual values as blank', () => {
    expect(isBlankForm({ field1: '123-45-6789', field2: null })).toBe(false)
    expect(isBlankForm({ field1: 50000 })).toBe(false)
    expect(isBlankForm({ field1: 'ACME Corp' })).toBe(false)
  })
})

describe('countFilledFields', () => {
  it('should count fields with actual values', () => {
    expect(countFilledFields({
      field1: '123-45-6789',
      field2: null,
      field3: 50000,
      field4: '',
      field5: 0,
    })).toBe(2) // field1 and field3
  })

  it('should return 0 for empty object', () => {
    expect(countFilledFields({})).toBe(0)
  })

  it('should return 0 for all-empty fields', () => {
    expect(countFilledFields({ a: null, b: '', c: 0 })).toBe(0)
  })
})

describe('parseCurrency', () => {
  it('should parse simple numbers', () => {
    expect(parseCurrency('1234.56')).toBe(1234.56)
    expect(parseCurrency('1234')).toBe(1234)
  })

  it('should parse formatted currency', () => {
    expect(parseCurrency('$1,234.56')).toBe(1234.56)
    expect(parseCurrency('$1,000,000')).toBe(1000000)
  })

  it('should handle number input', () => {
    expect(parseCurrency(1234.56)).toBe(1234.56)
  })

  it('should return null for invalid input', () => {
    expect(parseCurrency('abc')).toBe(null)
    expect(parseCurrency('$abc')).toBe(null)
  })

  it('should handle negative numbers', () => {
    expect(parseCurrency('-1234.56')).toBe(-1234.56)
  })
})

// ============================================
// EDGE CASES
// ============================================

describe('Edge Cases', () => {
  it('should handle very long values', () => {
    const longValue = '1'.repeat(1000)
    expect(() => validateFormat(longValue, 'ssn')).not.toThrow()
    expect(validateFormat(longValue, 'ssn').valid).toBe(false)
  })

  it('should handle special characters', () => {
    expect(validateSSN('123-45-6789!').valid).toBe(false)
    expect(validateEIN('12-3456789@').valid).toBe(false)
  })

  it('should handle unicode', () => {
    expect(validateCurrency('¥1234').valid).toBe(false) // Only $ supported
  })
})
