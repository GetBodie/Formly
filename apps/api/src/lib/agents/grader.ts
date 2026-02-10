/**
 * Grader Utilities - Format validators for the LLM-based grader
 * 
 * These are deterministic helpers that the LLM grader can call.
 * The actual PASS/FAIL decision is made by Claude using the validate_field_format tool.
 */

// ============================================
// TYPES
// ============================================

export interface FormatValidationResult {
  valid: boolean
  issue?: string
}

// ============================================
// FORMAT VALIDATORS
// ============================================

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
 * This is the main function called by the classifier agent's validate_field_format tool
 */
export function validateFormat(
  value: unknown,
  format?: string | RegExp | 'currency' | 'ssn' | 'ein' | 'date' | 'percentage'
): FormatValidationResult {
  if (!format) return { valid: true }
  if (value === null || value === undefined || value === '') {
    return { valid: true } // Empty values handled separately
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
// UTILITY FUNCTIONS
// ============================================

/**
 * Check if all fields in an extraction are empty/null
 * Useful for detecting blank form templates
 */
export function isBlankForm(fields: Record<string, unknown>): boolean {
  const values = Object.values(fields)
  if (values.length === 0) return true
  
  return values.every(val => {
    return val === null || val === undefined || val === '' || val === 0
  })
}

/**
 * Count how many fields have actual values
 */
export function countFilledFields(fields: Record<string, unknown>): number {
  return Object.values(fields).filter(val => {
    return val !== null && val !== undefined && val !== '' && val !== 0
  }).length
}

/**
 * Parse a currency string to a number
 */
export function parseCurrency(value: string | number): number | null {
  if (typeof value === 'number') return value
  const cleaned = String(value).replace(/[$,\s]/g, '')
  const num = parseFloat(cleaned)
  return isNaN(num) ? null : num
}

export default { 
  validateFormat, 
  validateSSN, 
  validateEIN, 
  validateCurrency, 
  validateDate, 
  validatePercentage,
  isBlankForm,
  countFilledFields,
  parseCurrency
}
