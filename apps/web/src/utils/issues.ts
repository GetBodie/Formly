/**
 * Issue parsing utilities for document review UI.
 *
 * Issue string format: [SEVERITY:TYPE:EXPECTED:DETECTED] Human-readable description
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
    const errorTypes = ['wrong_year', 'wrong_type', 'incomplete', 'illegible']
    const severity = errorTypes.includes(type) ? 'error' : 'warning'
    return { severity, type, expected: null, detected: null, description }
  }

  // Plain string
  return { severity: 'warning', type: 'other', expected: null, detected: null, description: issue }
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
    case 'missing_field':
      return parsed.expected
        ? `Request clearer document with visible ${parsed.expected.replace(/_/g, ' ')}`
        : 'Request clearer document with all fields visible'
    case 'low_confidence':
      return 'Manually verify document classification'
    default:
      return 'Review and take appropriate action'
  }
}

/**
 * Check if issues contain any errors.
 */
export function hasErrors(issues: string[]): boolean {
  return issues.some(issue => parseIssue(issue).severity === 'error')
}

/**
 * Check if issues contain any warnings.
 */
export function hasWarnings(issues: string[]): boolean {
  return issues.some(issue => parseIssue(issue).severity === 'warning')
}
