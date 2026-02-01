/**
 * Issue parsing utilities for document review.
 *
 * Issue string format: [SEVERITY:TYPE:EXPECTED:DETECTED] Human-readable description
 * Examples:
 *   [ERROR:wrong_year:2025:2024] Document is from 2024, expected 2025
 *   [WARNING:low_confidence::] Classification confidence below 70%
 */

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
export function parseIssue(issue: string): ParsedIssue {
  // New format: [SEVERITY:TYPE:EXPECTED:DETECTED] description
  const newFormatMatch = issue.match(/^\[(\w+):(\w+):([^:]*):([^\]]*)\]\s*(.+)$/)
  if (newFormatMatch) {
    const [, severity, type, expected, detected, description] = newFormatMatch
    return {
      severity: severity.toLowerCase() as 'error' | 'warning',
      type,
      expected: expected || null,
      detected: detected || null,
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
