/**
 * Form Templates - Lightweight hints for the LLM classifier
 * 
 * PHILOSOPHY: These are HINTS, not hard requirements.
 * The LLM grader generalizes — it asks "is this a properly filled tax document?"
 * not "did field X match schema Y?"
 * 
 * We provide a few examples (W-2, 1099-NEC) as guidance.
 * The LLM handles unknown document types gracefully.
 */

export interface FormField {
  name: string
  description: string
  location?: string  // Hint for where to find it
}

export interface FormTemplate {
  type: string
  displayName: string
  exampleFields: FormField[]  // Examples of what to look for, not requirements
  confidenceThreshold: number
}

/**
 * Example templates - hints for common form types
 * The LLM uses these as guidance but can handle any document type
 */
export const FORM_TEMPLATES: Record<string, FormTemplate> = {
  'W-2': {
    type: 'W-2',
    displayName: 'Form W-2 (Wage and Tax Statement)',
    confidenceThreshold: 0.75,
    exampleFields: [
      { name: 'employee_ssn', description: 'Employee SSN', location: 'Box a' },
      { name: 'employer_ein', description: 'Employer EIN', location: 'Box b' },
      { name: 'employer_name', description: 'Employer name', location: 'Box c' },
      { name: 'wages_tips', description: 'Wages, tips, compensation', location: 'Box 1' },
      { name: 'federal_tax_withheld', description: 'Federal tax withheld', location: 'Box 2' },
      { name: 'tax_year', description: 'Tax year', location: 'Top of form' },
    ]
  },
  
  '1099-NEC': {
    type: '1099-NEC',
    displayName: 'Form 1099-NEC (Nonemployee Compensation)',
    confidenceThreshold: 0.75,
    exampleFields: [
      { name: 'payer_tin', description: 'Payer TIN', location: "PAYER'S TIN" },
      { name: 'payer_name', description: 'Payer name', location: "PAYER'S name" },
      { name: 'recipient_tin', description: 'Recipient TIN', location: "RECIPIENT'S TIN" },
      { name: 'nonemployee_compensation', description: 'Compensation amount', location: 'Box 1' },
      { name: 'tax_year', description: 'Tax year', location: 'Top of form' },
    ]
  },
}

/**
 * Get template hints for a document type
 * Returns undefined for unknown types (LLM handles gracefully)
 */
export function getFormTemplate(documentType: string): FormTemplate | undefined {
  return FORM_TEMPLATES[documentType]
}

/**
 * Get list of known document types (for prompts)
 */
export function getKnownDocumentTypes(): string[] {
  return Object.keys(FORM_TEMPLATES)
}

/**
 * Get a brief description of known types for LLM context
 */
export function getDocumentTypeHints(): string {
  const hints = Object.values(FORM_TEMPLATES)
    .map(t => `- ${t.type}: ${t.displayName}`)
    .join('\n')
  
  return `Known form types:\n${hints}\n\nOther types (RECEIPT, STATEMENT, OTHER) are also valid.`
}
