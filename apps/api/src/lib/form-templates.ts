/**
 * Form Templates - Schema definitions for tax documents
 * 
 * Defines expected fields for each document type. This is the "schema"
 * the extractor tries to fill and the grader validates against.
 */

export interface FormField {
  name: string
  description: string
  required: boolean
  format?: RegExp | 'currency' | 'ssn' | 'ein' | 'date' | 'percentage'
  location?: string  // Hint for where to find it on the form
}

export interface FormTemplate {
  type: string
  displayName: string
  fields: FormField[]
  confidenceThreshold: number  // Min confidence to auto-accept
  minRequiredFields: number    // At least N required fields must be filled
}

export const FORM_TEMPLATES: Record<string, FormTemplate> = {
  'W-2': {
    type: 'W-2',
    displayName: 'Form W-2 (Wage and Tax Statement)',
    confidenceThreshold: 0.8,
    minRequiredFields: 4,
    fields: [
      { name: 'employee_ssn', description: 'Employee SSN', required: true, format: 'ssn', location: 'Box a' },
      { name: 'employer_ein', description: 'Employer EIN', required: true, format: 'ein', location: 'Box b' },
      { name: 'employer_name', description: 'Employer name and address', required: true, location: 'Box c' },
      { name: 'employee_name', description: 'Employee name and address', required: false, location: 'Box e/f' },
      { name: 'wages_tips', description: 'Wages, tips, other compensation', required: true, format: 'currency', location: 'Box 1' },
      { name: 'federal_tax_withheld', description: 'Federal income tax withheld', required: true, format: 'currency', location: 'Box 2' },
      { name: 'ss_wages', description: 'Social security wages', required: false, format: 'currency', location: 'Box 3' },
      { name: 'ss_tax_withheld', description: 'Social security tax withheld', required: false, format: 'currency', location: 'Box 4' },
      { name: 'medicare_wages', description: 'Medicare wages and tips', required: false, format: 'currency', location: 'Box 5' },
      { name: 'medicare_tax_withheld', description: 'Medicare tax withheld', required: false, format: 'currency', location: 'Box 6' },
      { name: 'tax_year', description: 'Tax year', required: true, format: /^20\d{2}$/, location: 'Top right corner' },
    ]
  },
  
  '1099-NEC': {
    type: '1099-NEC',
    displayName: 'Form 1099-NEC (Nonemployee Compensation)',
    confidenceThreshold: 0.75,
    minRequiredFields: 3,
    fields: [
      { name: 'payer_tin', description: 'Payer TIN', required: true, format: 'ein', location: "PAYER'S TIN" },
      { name: 'payer_name', description: 'Payer name and address', required: true, location: "PAYER'S name" },
      { name: 'recipient_tin', description: 'Recipient TIN', required: true, format: 'ssn', location: "RECIPIENT'S TIN" },
      { name: 'recipient_name', description: 'Recipient name', required: false, location: "RECIPIENT'S name" },
      { name: 'nonemployee_compensation', description: 'Nonemployee compensation', required: true, format: 'currency', location: 'Box 1' },
      { name: 'federal_tax_withheld', description: 'Federal income tax withheld', required: false, format: 'currency', location: 'Box 4' },
      { name: 'tax_year', description: 'Tax year', required: true, format: /^20\d{2}$/, location: 'Top of form' },
    ]
  },
  
  '1099-INT': {
    type: '1099-INT',
    displayName: 'Form 1099-INT (Interest Income)',
    confidenceThreshold: 0.75,
    minRequiredFields: 3,
    fields: [
      { name: 'payer_tin', description: 'Payer TIN', required: true, format: 'ein', location: "PAYER'S TIN" },
      { name: 'payer_name', description: 'Payer name', required: true, location: "PAYER'S name" },
      { name: 'recipient_tin', description: 'Recipient TIN', required: true, format: 'ssn', location: "RECIPIENT'S TIN" },
      { name: 'recipient_name', description: 'Recipient name', required: false, location: "RECIPIENT'S name" },
      { name: 'interest_income', description: 'Interest income', required: true, format: 'currency', location: 'Box 1' },
      { name: 'early_withdrawal_penalty', description: 'Early withdrawal penalty', required: false, format: 'currency', location: 'Box 2' },
      { name: 'interest_on_savings_bonds', description: 'Interest on U.S. Savings Bonds', required: false, format: 'currency', location: 'Box 3' },
      { name: 'federal_tax_withheld', description: 'Federal income tax withheld', required: false, format: 'currency', location: 'Box 4' },
      { name: 'tax_year', description: 'Tax year', required: true, format: /^20\d{2}$/, location: 'Top of form' },
    ]
  },
  
  '1099-DIV': {
    type: '1099-DIV',
    displayName: 'Form 1099-DIV (Dividends and Distributions)',
    confidenceThreshold: 0.75,
    minRequiredFields: 3,
    fields: [
      { name: 'payer_tin', description: 'Payer TIN', required: true, format: 'ein', location: "PAYER'S TIN" },
      { name: 'payer_name', description: 'Payer name', required: true, location: "PAYER'S name" },
      { name: 'recipient_tin', description: 'Recipient TIN', required: true, format: 'ssn', location: "RECIPIENT'S TIN" },
      { name: 'recipient_name', description: 'Recipient name', required: false, location: "RECIPIENT'S name" },
      { name: 'total_dividends', description: 'Total ordinary dividends', required: true, format: 'currency', location: 'Box 1a' },
      { name: 'qualified_dividends', description: 'Qualified dividends', required: false, format: 'currency', location: 'Box 1b' },
      { name: 'capital_gain_distributions', description: 'Total capital gain distributions', required: false, format: 'currency', location: 'Box 2a' },
      { name: 'federal_tax_withheld', description: 'Federal income tax withheld', required: false, format: 'currency', location: 'Box 4' },
      { name: 'tax_year', description: 'Tax year', required: true, format: /^20\d{2}$/, location: 'Top of form' },
    ]
  },
  
  '1099-MISC': {
    type: '1099-MISC',
    displayName: 'Form 1099-MISC (Miscellaneous Income)',
    confidenceThreshold: 0.7,
    minRequiredFields: 3,
    fields: [
      { name: 'payer_tin', description: 'Payer TIN', required: true, format: 'ein', location: "PAYER'S TIN" },
      { name: 'payer_name', description: 'Payer name', required: true, location: "PAYER'S name" },
      { name: 'recipient_tin', description: 'Recipient TIN', required: true, format: 'ssn', location: "RECIPIENT'S TIN" },
      { name: 'recipient_name', description: 'Recipient name', required: false, location: "RECIPIENT'S name" },
      { name: 'rents', description: 'Rents', required: false, format: 'currency', location: 'Box 1' },
      { name: 'royalties', description: 'Royalties', required: false, format: 'currency', location: 'Box 2' },
      { name: 'other_income', description: 'Other income', required: false, format: 'currency', location: 'Box 3' },
      { name: 'federal_tax_withheld', description: 'Federal income tax withheld', required: false, format: 'currency', location: 'Box 4' },
      { name: 'fishing_boat_proceeds', description: 'Fishing boat proceeds', required: false, format: 'currency', location: 'Box 5' },
      { name: 'medical_payments', description: 'Medical and health care payments', required: false, format: 'currency', location: 'Box 6' },
      { name: 'tax_year', description: 'Tax year', required: true, format: /^20\d{2}$/, location: 'Top of form' },
    ]
  },
  
  'K-1': {
    type: 'K-1',
    displayName: 'Schedule K-1 (Partner/Shareholder Share)',
    confidenceThreshold: 0.7,
    minRequiredFields: 3,
    fields: [
      { name: 'partnership_ein', description: 'Partnership/S-Corp EIN', required: true, format: 'ein', location: 'Box A or B' },
      { name: 'partnership_name', description: 'Partnership/S-Corp name', required: true, location: 'Part I' },
      { name: 'partner_tin', description: 'Partner/Shareholder TIN', required: true, format: 'ssn', location: 'Box E or F' },
      { name: 'partner_name', description: 'Partner/Shareholder name', required: false, location: 'Part II' },
      { name: 'ordinary_income', description: 'Ordinary business income (loss)', required: false, format: 'currency', location: 'Box 1' },
      { name: 'net_rental_income', description: 'Net rental real estate income (loss)', required: false, format: 'currency', location: 'Box 2' },
      { name: 'other_net_rental_income', description: 'Other net rental income (loss)', required: false, format: 'currency', location: 'Box 3' },
      { name: 'guaranteed_payments', description: 'Guaranteed payments', required: false, format: 'currency', location: 'Box 4' },
      { name: 'interest_income', description: 'Interest income', required: false, format: 'currency', location: 'Box 5' },
      { name: 'dividends', description: 'Dividends', required: false, format: 'currency', location: 'Box 6' },
      { name: 'tax_year', description: 'Tax year', required: true, format: /^20\d{2}$/, location: 'Top of form' },
    ]
  },
  
  '1099-B': {
    type: '1099-B',
    displayName: 'Form 1099-B (Proceeds from Broker Transactions)',
    confidenceThreshold: 0.7,
    minRequiredFields: 3,
    fields: [
      { name: 'payer_tin', description: 'Payer TIN', required: true, format: 'ein', location: "PAYER'S TIN" },
      { name: 'payer_name', description: 'Payer name', required: true, location: "PAYER'S name" },
      { name: 'recipient_tin', description: 'Recipient TIN', required: true, format: 'ssn', location: "RECIPIENT'S TIN" },
      { name: 'proceeds', description: 'Proceeds', required: false, format: 'currency', location: 'Box 1d' },
      { name: 'cost_basis', description: 'Cost or other basis', required: false, format: 'currency', location: 'Box 1e' },
      { name: 'tax_year', description: 'Tax year', required: true, format: /^20\d{2}$/, location: 'Top of form' },
    ]
  },
  
  '1099-R': {
    type: '1099-R',
    displayName: 'Form 1099-R (Distributions From Pensions, Annuities, etc.)',
    confidenceThreshold: 0.75,
    minRequiredFields: 3,
    fields: [
      { name: 'payer_tin', description: 'Payer TIN', required: true, format: 'ein', location: "PAYER'S TIN" },
      { name: 'payer_name', description: 'Payer name', required: true, location: "PAYER'S name" },
      { name: 'recipient_tin', description: 'Recipient TIN', required: true, format: 'ssn', location: "RECIPIENT'S TIN" },
      { name: 'gross_distribution', description: 'Gross distribution', required: true, format: 'currency', location: 'Box 1' },
      { name: 'taxable_amount', description: 'Taxable amount', required: false, format: 'currency', location: 'Box 2a' },
      { name: 'federal_tax_withheld', description: 'Federal income tax withheld', required: false, format: 'currency', location: 'Box 4' },
      { name: 'distribution_code', description: 'Distribution code(s)', required: false, location: 'Box 7' },
      { name: 'tax_year', description: 'Tax year', required: true, format: /^20\d{2}$/, location: 'Top of form' },
    ]
  },
}

// Fallback for unknown document types
export const GENERIC_TEMPLATE: FormTemplate = {
  type: 'OTHER',
  displayName: 'Unknown Document',
  confidenceThreshold: 0.5,
  minRequiredFields: 1,
  fields: [
    { name: 'document_title', description: 'Document title or type', required: false },
    { name: 'tax_year', description: 'Tax year if visible', required: false, format: /^20\d{2}$/ },
    { name: 'issuer_name', description: 'Issuing organization', required: false },
    { name: 'recipient_name', description: 'Recipient name', required: false },
    { name: 'any_amounts', description: 'Any dollar amounts visible', required: false, format: 'currency' },
  ]
}

/**
 * Get the template for a document type, falling back to GENERIC_TEMPLATE
 */
export function getFormTemplate(documentType: string): FormTemplate {
  return FORM_TEMPLATES[documentType] || GENERIC_TEMPLATE
}

/**
 * Get all known document types
 */
export function getKnownDocumentTypes(): string[] {
  return Object.keys(FORM_TEMPLATES)
}
