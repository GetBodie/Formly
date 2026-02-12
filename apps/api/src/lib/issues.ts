/**
 * Issue parsing utilities for document review.
 *
 * Issue string format: [SEVERITY:TYPE:EXPECTED:DETECTED] Human-readable description
 * Examples:
 *   [ERROR:wrong_year:2025:2024] Document is from 2024, expected 2025
 *   [WARNING:low_confidence::] Classification confidence below 70%
 */

// ============================================
// ISSUE NORMALIZATION (LLM output safety net)
// ============================================

/**
 * Generate a human-readable description for an issue based on type and fields.
 */
function generateDescription(
  type: string,
  expected: string | null,
  detected: string | null
): string {
  const fieldName = expected?.replace(/_/g, ' ') || 'field'
  const detectedValue = detected && detected !== 'null' ? detected : 'not detected'

  switch (type) {
    case 'missing_field':
      return `${capitalizeFirst(fieldName)} is required but was not found on the document`
    case 'invalid_format':
      return `${capitalizeFirst(fieldName)} has invalid format (found: ${detectedValue})`
    case 'wrong_year':
      return `Document appears to be from tax year ${detectedValue}, expected ${expected || 'different year'}`
    case 'wrong_type':
      return `Document appears to be a ${detectedValue}, not ${expected || 'expected type'}`
    case 'suspicious_value':
      return `${capitalizeFirst(fieldName)} value of ${detectedValue} seems unusual`
    case 'incomplete':
      return `Document appears incomplete or missing data`
    default:
      return `Issue with ${fieldName}: ${detectedValue}`
  }
}

function capitalizeFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/**
 * Normalize a potentially malformed issue string into the correct format.
 * Handles cases where LLM outputs raw format without brackets or description.
 *
 * Transforms:
 *   ERROR:missing_field:employer_name:detected:null
 * Into:
 *   [ERROR:missing_field:employer_name:null] Employer name is required but was not found
 */
export function normalizeIssue(issue: string): string {
  // Already in correct format - has brackets and description
  if (/^\[[\w:]+\]\s+.+$/.test(issue)) {
    return issue
  }

  // Has brackets but missing description: [ERROR:missing_field:employer_name:null]
  const bracketsOnlyMatch = issue.match(/^\[(ERROR|WARNING):(\w+):([^:]*):([^\]]*)\]$/)
  if (bracketsOnlyMatch) {
    const [, severity, type, expected, detected] = bracketsOnlyMatch
    const description = generateDescription(type, expected, detected)
    return `[${severity}:${type}:${expected}:${detected}] ${description}`
  }

  // Raw format with 5 parts: ERROR:missing_field:employer_name:detected:null
  const raw5Match = issue.match(/^(ERROR|WARNING):(\w+):([^:]*):detected:(.*)$/)
  if (raw5Match) {
    const [, severity, type, expected, detected] = raw5Match
    const description = generateDescription(type, expected, detected)
    return `[${severity}:${type}:${expected}:${detected}] ${description}`
  }

  // Raw format with 4 parts: ERROR:missing_field:employer_name:null
  const raw4Match = issue.match(/^(ERROR|WARNING):(\w+):([^:]*):(.*)$/)
  if (raw4Match) {
    const [, severity, type, expected, detected] = raw4Match
    const description = generateDescription(type, expected, detected)
    return `[${severity}:${type}:${expected}:${detected}] ${description}`
  }

  // Raw format with 3 parts: ERROR:missing_field:employer_name
  const raw3Match = issue.match(/^(ERROR|WARNING):(\w+):(.+)$/)
  if (raw3Match) {
    const [, severity, type, field] = raw3Match
    const description = generateDescription(type, field, null)
    return `[${severity}:${type}:${field}:null] ${description}`
  }

  // Raw format with 2 parts: ERROR:missing_field
  const raw2Match = issue.match(/^(ERROR|WARNING):(\w+)$/)
  if (raw2Match) {
    const [, severity, type] = raw2Match
    const description = generateDescription(type, null, null)
    return `[${severity}:${type}::] ${description}`
  }

  // Can't normalize - return as-is with warning wrapper
  if (!issue.startsWith('[')) {
    return `[WARNING:other::] ${issue}`
  }

  return issue
}

/**
 * Normalize an array of issues, fixing any malformed LLM output.
 */
export function normalizeIssues(issues: string[]): string[] {
  return issues.map(normalizeIssue)
}

// ============================================
// ISSUE PARSING
// ============================================

export interface ParsedIssue {
  severity: 'error' | 'warning'
  type: string
  expected: string | null
  detected: string | null
  description: string
}

/**
 * Parse an issue string into its components.
 * Falls back gracefully for legacy or malformed strings.
 */
function normalizeSeverity(raw: string): 'error' | 'warning' {
  const lower = raw.toLowerCase()
  if (lower === 'error' || lower === 'critical') return 'error'
  return 'warning'
}

export function parseIssue(issue: string): ParsedIssue {
  // Full format: [SEVERITY:TYPE:EXPECTED:DETECTED] description
  const fullMatch = issue.match(/^\[(\w+):(\w+):([^:]*):([^\]]*)\]\s*(.+)$/)
  if (fullMatch) {
    const [, severity, type, expected, detected, description] = fullMatch
    return {
      severity: normalizeSeverity(severity),
      type,
      expected: expected || null,
      detected: detected || null,
      description,
    }
  }

  // Short format: [SEVERITY:TYPE] description (no expected/detected)
  const shortMatch = issue.match(/^\[(\w+):(\w+)\]\s*(.+)$/)
  if (shortMatch) {
    const [, severity, type, description] = shortMatch
    return {
      severity: normalizeSeverity(severity),
      type,
      expected: null,
      detected: null,
      description,
    }
  }

  // Legacy format: [type] description
  const legacyMatch = issue.match(/^\[(\w+)\]\s*(.+)$/)
  if (legacyMatch) {
    const [, type, description] = legacyMatch
    const severity = isErrorType(type) ? 'error' : 'warning'
    return {
      severity,
      type,
      expected: null,
      detected: null,
      description,
    }
  }

  // Plain string - treat as warning with unknown type
  return {
    severity: 'warning',
    type: 'other',
    expected: null,
    detected: null,
    description: issue,
  }
}

/**
 * Determine if an issue type is an error (blocks completion) or warning (advisory).
 */
export function isErrorType(type: string): boolean {
  const errorTypes = ['wrong_year', 'wrong_type', 'incomplete', 'illegible']
  return errorTypes.includes(type)
}

/**
 * Generate a suggested action based on the parsed issue.
 */
export function getSuggestedAction(parsed: ParsedIssue): string {
  switch (parsed.type) {
    case 'wrong_year':
      return parsed.expected
        ? `Request document for tax year ${parsed.expected}`
        : 'Request document for the correct tax year'
    case 'wrong_type':
      if (parsed.expected && parsed.detected) {
        return `Request ${parsed.expected} instead of ${parsed.detected}`
      }
      return 'Request the correct document type'
    case 'incomplete':
      return 'Request complete document with all pages'
    case 'illegible':
      return 'Request clearer scan or photo'
    case 'duplicate':
      return 'Verify if duplicate is intentional'
    case 'low_confidence':
      return 'Manually verify document classification'
    default:
      return 'Review and take appropriate action'
  }
}

/**
 * Check if a document has any unresolved errors (not just warnings).
 */
export function hasErrors(issues: string[]): boolean {
  return issues.some(issue => {
    const parsed = parseIssue(issue)
    return parsed.severity === 'error'
  })
}

/**
 * Check if a document has any warnings.
 */
export function hasWarnings(issues: string[]): boolean {
  return issues.some(issue => {
    const parsed = parseIssue(issue)
    return parsed.severity === 'warning'
  })
}
