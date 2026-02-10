# Agentic Document Classification Pipeline

## Overview

Replace single-pass classification with an iterative agent loop that treats classification as a **form-filling problem**: "Can I extract enough fields to confidently fill this form template?"

## Current vs Proposed

### Current (Single-Pass)
```
Document → OCR → classifyDocument() → Done
```
- One attempt, one answer
- Low-confidence results get flagged but never retried
- Blank forms sometimes get high confidence (hallucination)

### Proposed (Agentic Loop)
```
Document → OCR → [Extractor → Grader → Feedback]* → Result
```
- Multiple attempts with targeted feedback
- Grader validates extraction quality before accepting
- Escalates to human review after max attempts

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    AGENTIC CLASSIFIER                        │
│                                                              │
│  Input: OCR text, fileName, taxYear                         │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │                    LOOP (max 3)                      │    │
│  │                                                      │    │
│  │   ┌──────────────┐         ┌──────────────────┐     │    │
│  │   │  EXTRACTOR   │────────▶│     GRADER       │     │    │
│  │   │              │         │                  │     │    │
│  │   │ "Fill the    │         │ "Is this good    │     │    │
│  │   │  form fields │         │  enough?"        │     │    │
│  │   │  from OCR"   │         │                  │     │    │
│  │   └──────────────┘         └────────┬─────────┘     │    │
│  │          ▲                          │               │    │
│  │          │     FAIL + feedback      │               │    │
│  │          └──────────────────────────┘               │    │
│  │                                     │ PASS          │    │
│  └─────────────────────────────────────┼───────────────┘    │
│                                        ▼                    │
│  Output: { documentType, confidence, fields, issues }       │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Component 1: Form Templates

Define expected fields for each document type. This is the "schema" the extractor tries to fill.

```typescript
// lib/form-templates.ts

export interface FormField {
  name: string
  description: string
  required: boolean
  format?: RegExp | 'currency' | 'ssn' | 'ein' | 'date' | 'percentage'
  location?: string  // Hint for where to find it
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
      { name: 'payer_tin', description: 'Payer TIN', required: true, format: 'ein', location: 'PAYER\'S TIN' },
      { name: 'payer_name', description: 'Payer name and address', required: true, location: 'PAYER\'S name' },
      { name: 'recipient_tin', description: 'Recipient TIN', required: true, format: 'ssn', location: 'RECIPIENT\'S TIN' },
      { name: 'recipient_name', description: 'Recipient name', required: false, location: 'RECIPIENT\'S name' },
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
      { name: 'payer_tin', description: 'Payer TIN', required: true, format: 'ein', location: 'PAYER\'S TIN' },
      { name: 'payer_name', description: 'Payer name', required: true, location: 'PAYER\'S name' },
      { name: 'recipient_tin', description: 'Recipient TIN', required: true, format: 'ssn', location: 'RECIPIENT\'S TIN' },
      { name: 'interest_income', description: 'Interest income', required: true, format: 'currency', location: 'Box 1' },
      { name: 'early_withdrawal_penalty', description: 'Early withdrawal penalty', required: false, format: 'currency', location: 'Box 2' },
      { name: 'tax_year', description: 'Tax year', required: true, format: /^20\d{2}$/, location: 'Top of form' },
    ]
  },
  
  '1099-DIV': {
    type: '1099-DIV',
    displayName: 'Form 1099-DIV (Dividends and Distributions)',
    confidenceThreshold: 0.75,
    minRequiredFields: 3,
    fields: [
      { name: 'payer_tin', description: 'Payer TIN', required: true, format: 'ein', location: 'PAYER\'S TIN' },
      { name: 'payer_name', description: 'Payer name', required: true, location: 'PAYER\'S name' },
      { name: 'recipient_tin', description: 'Recipient TIN', required: true, format: 'ssn', location: 'RECIPIENT\'S TIN' },
      { name: 'total_dividends', description: 'Total ordinary dividends', required: true, format: 'currency', location: 'Box 1a' },
      { name: 'qualified_dividends', description: 'Qualified dividends', required: false, format: 'currency', location: 'Box 1b' },
      { name: 'tax_year', description: 'Tax year', required: true, format: /^20\d{2}$/, location: 'Top of form' },
    ]
  },
  
  '1099-MISC': {
    type: '1099-MISC',
    displayName: 'Form 1099-MISC (Miscellaneous Income)',
    confidenceThreshold: 0.7,
    minRequiredFields: 3,
    fields: [
      { name: 'payer_tin', description: 'Payer TIN', required: true, format: 'ein', location: 'PAYER\'S TIN' },
      { name: 'payer_name', description: 'Payer name', required: true, location: 'PAYER\'S name' },
      { name: 'recipient_tin', description: 'Recipient TIN', required: true, format: 'ssn', location: 'RECIPIENT\'S TIN' },
      { name: 'rents', description: 'Rents', required: false, format: 'currency', location: 'Box 1' },
      { name: 'royalties', description: 'Royalties', required: false, format: 'currency', location: 'Box 2' },
      { name: 'other_income', description: 'Other income', required: false, format: 'currency', location: 'Box 3' },
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
```

---

## Component 2: The Extractor

The extractor's job: Given OCR text and optional feedback, try to identify the document type and fill as many fields as possible.

```typescript
// lib/agents/extractor.ts

interface ExtractionResult {
  likelyType: string           // Best guess at document type
  alternativeTypes: string[]   // Other possibilities
  fields: Record<string, {
    value: string | number | null
    confidence: number         // 0-1 for this specific field
    rawText?: string           // The original text snippet
  }>
  overallConfidence: number
  reasoning: string            // Why this classification
}

const EXTRACTOR_SYSTEM_PROMPT = `You are a tax document field extractor. Your job is to:

1. Identify the document type (W-2, 1099-NEC, 1099-INT, 1099-DIV, 1099-MISC, K-1, RECEIPT, STATEMENT, or OTHER)
2. Extract all visible field values into structured data
3. Report confidence for each extraction

IMPORTANT RULES:
- Only extract values you can actually see in the text
- If a field is blank, cut off, or illegible, set value to null
- Don't hallucinate or guess values that aren't visible
- A blank form template (no filled values) should be classified as OTHER with low confidence
- Look for specific patterns: SSN (XXX-XX-XXXX), EIN (XX-XXXXXXX), currency ($X,XXX.XX)

For each field, report:
- value: The extracted value (null if not found)
- confidence: 0-1 how sure you are this is correct
- rawText: The exact text snippet you extracted from (for verification)

Think step by step:
1. What type of document does this appear to be?
2. What fields can I definitively see filled in?
3. Are there any fields I'm uncertain about?`

async function extract(
  ocrText: string,
  fileName: string,
  feedback?: string,
  expectedTaxYear?: number
): Promise<ExtractionResult> {
  const userPrompt = feedback 
    ? `Previous attempt feedback: ${feedback}\n\nPlease try again with this guidance.\n\nFile: ${fileName}\n\nOCR Text:\n${ocrText}`
    : `File: ${fileName}\n\nOCR Text:\n${ocrText}`

  // Call LLM with structured output
  const response = await openai.chat.completions.parse({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: EXTRACTOR_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt }
    ],
    response_format: zodResponseFormat(ExtractionResultSchema, 'extraction'),
    temperature: 0
  })
  
  return response.choices[0].message.parsed
}
```

---

## Component 3: The Grader (THE CRITICAL PIECE)

The grader decides whether an extraction is good enough, or what to try next.

### Grader Responsibilities

1. **Validate field formats** — Is the SSN actually an SSN? Is the currency a valid amount?
2. **Check required fields** — Does this form type have its critical fields filled?
3. **Cross-reference consistency** — Do the extracted values make sense together?
4. **Detect blank/template forms** — All fields null = probably a blank form
5. **Verify tax year** — Does it match the expected year?
6. **Generate actionable feedback** — Tell the extractor exactly what to look for

### Grader Logic (Detailed)

```typescript
// lib/agents/grader.ts

interface GradeResult {
  pass: boolean
  score: number                    // 0-100 overall quality score
  documentType: string             // Confirmed or adjusted type
  confidence: number               // Final confidence
  
  // Detailed breakdown
  fieldResults: Record<string, {
    valid: boolean
    issue?: string
  }>
  
  // If not passing, why and what to try
  failureReasons: string[]
  feedback: string                 // Specific guidance for next attempt
  
  // Final issues to report (even on pass)
  issues: string[]
}

interface GraderContext {
  extraction: ExtractionResult
  ocrText: string
  fileName: string
  expectedTaxYear?: number
  attemptNumber: number
}

async function grade(ctx: GraderContext): Promise<GradeResult> {
  const { extraction, ocrText, expectedTaxYear, attemptNumber } = ctx
  
  const template = FORM_TEMPLATES[extraction.likelyType] || GENERIC_TEMPLATE
  const fieldResults: Record<string, { valid: boolean; issue?: string }> = {}
  const failureReasons: string[] = []
  const issues: string[] = []
  
  // ============================================
  // RULE 1: Validate field formats
  // ============================================
  for (const fieldDef of template.fields) {
    const extracted = extraction.fields[fieldDef.name]
    
    if (!extracted || extracted.value === null) {
      if (fieldDef.required) {
        fieldResults[fieldDef.name] = { 
          valid: false, 
          issue: `Required field missing: ${fieldDef.description}` 
        }
        failureReasons.push(`Missing ${fieldDef.description} (${fieldDef.location || 'location unknown'})`)
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
    return extracted && extracted.value !== null && fieldResults[f.name]?.valid !== false
  })
  
  const requiredFieldRatio = filledRequiredFields.length / requiredFields.length
  
  if (filledRequiredFields.length < template.minRequiredFields) {
    failureReasons.push(
      `Only ${filledRequiredFields.length}/${template.minRequiredFields} minimum required fields found`
    )
  }
  
  // ============================================
  // RULE 3: Detect blank/template forms
  // ============================================
  const allFieldsNull = Object.values(extraction.fields)
    .every(f => f.value === null || f.value === '' || f.value === 0)
  
  if (allFieldsNull) {
    failureReasons.push('Document appears to be a blank template with no filled values')
    issues.push('[ERROR:incomplete::] Document appears to be a blank form template. Please upload a completed form with actual data.')
  }
  
  // ============================================
  // RULE 4: Tax year validation
  // ============================================
  const extractedYear = extraction.fields['tax_year']?.value
  if (expectedTaxYear && extractedYear) {
    if (Number(extractedYear) !== expectedTaxYear) {
      issues.push(`[ERROR:wrong_year:${expectedTaxYear}:${extractedYear}] Document is for tax year ${extractedYear}, but we need ${expectedTaxYear}`)
    }
  } else if (expectedTaxYear && !extractedYear) {
    issues.push(`[WARNING:missing_field:tax_year:] Could not determine tax year from document`)
  }
  
  // ============================================
  // RULE 5: Cross-reference sanity checks
  // ============================================
  
  // W-2 specific: SS wages shouldn't exceed total wages
  if (extraction.likelyType === 'W-2') {
    const wages = parseFloat(extraction.fields['wages_tips']?.value as string) || 0
    const ssWages = parseFloat(extraction.fields['ss_wages']?.value as string) || 0
    if (ssWages > wages * 1.1) { // Allow 10% tolerance
      issues.push('[WARNING:inconsistent::] Social security wages exceed total wages - please verify')
    }
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
  const validFieldRatio = Object.values(fieldResults).filter(r => r.valid).length / 
                          Object.values(fieldResults).length || 0
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
      return f.required && (!extracted || extracted.value === null)
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
    score,
    documentType: pass ? extraction.likelyType : (allFieldsNull ? 'OTHER' : extraction.likelyType),
    confidence: pass ? extraction.overallConfidence : Math.min(extraction.overallConfidence, 0.5),
    fieldResults,
    failureReasons,
    feedback,
    issues
  }
}

// ============================================
// FORMAT VALIDATORS
// ============================================

function validateFormat(
  value: unknown, 
  format?: RegExp | 'currency' | 'ssn' | 'ein' | 'date' | 'percentage'
): { valid: boolean; issue?: string } {
  if (!format) return { valid: true }
  
  const strValue = String(value)
  
  if (format instanceof RegExp) {
    return format.test(strValue) 
      ? { valid: true }
      : { valid: false, issue: `Value "${strValue}" doesn't match expected format` }
  }
  
  switch (format) {
    case 'ssn':
      // Accept XXX-XX-XXXX or XXXXXXXXX or partially masked
      const ssnPattern = /^(\d{3}-?\d{2}-?\d{4}|\*{3}-?\*{2}-?\d{4})$/
      return ssnPattern.test(strValue.replace(/\s/g, ''))
        ? { valid: true }
        : { valid: false, issue: `"${strValue}" is not a valid SSN format` }
    
    case 'ein':
      // Accept XX-XXXXXXX or XXXXXXXXX
      const einPattern = /^\d{2}-?\d{7}$/
      return einPattern.test(strValue.replace(/\s/g, ''))
        ? { valid: true }
        : { valid: false, issue: `"${strValue}" is not a valid EIN format` }
    
    case 'currency':
      // Accept various currency formats: $1,234.56 or 1234.56 or 1,234
      const cleanedValue = strValue.replace(/[$,\s]/g, '')
      const currencyPattern = /^-?\d+(\.\d{0,2})?$/
      return currencyPattern.test(cleanedValue)
        ? { valid: true }
        : { valid: false, issue: `"${strValue}" is not a valid currency amount` }
    
    case 'date':
      // Basic date validation
      const date = new Date(strValue)
      return !isNaN(date.getTime())
        ? { valid: true }
        : { valid: false, issue: `"${strValue}" is not a valid date` }
    
    case 'percentage':
      const pctPattern = /^\d+(\.\d+)?%?$/
      return pctPattern.test(strValue)
        ? { valid: true }
        : { valid: false, issue: `"${strValue}" is not a valid percentage` }
    
    default:
      return { valid: true }
  }
}
```

---

## Component 4: The Loop Orchestrator

Ties it all together.

```typescript
// lib/agents/classifier-agent.ts

interface ClassificationResult {
  documentType: string
  confidence: number
  taxYear: number | null
  issues: string[]
  extractedFields: Record<string, unknown>  // Bonus: we now have structured data
  attempts: number
}

const MAX_ATTEMPTS = 3

export async function classifyDocumentAgentic(
  ocrText: string,
  fileName: string,
  expectedTaxYear?: number
): Promise<ClassificationResult> {
  let feedback: string | undefined
  let lastExtraction: ExtractionResult | null = null
  let lastGrade: GradeResult | null = null
  
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    console.log(`[CLASSIFIER] Attempt ${attempt}/${MAX_ATTEMPTS} for ${fileName}`)
    
    // Step 1: Extract
    const extraction = await extract(ocrText, fileName, feedback, expectedTaxYear)
    lastExtraction = extraction
    
    console.log(`[CLASSIFIER] Extracted as ${extraction.likelyType} (${(extraction.overallConfidence * 100).toFixed(0)}% confidence)`)
    
    // Step 2: Grade
    const grade = await grade({
      extraction,
      ocrText,
      fileName,
      expectedTaxYear,
      attemptNumber: attempt
    })
    lastGrade = grade
    
    console.log(`[CLASSIFIER] Grade: ${grade.pass ? 'PASS' : 'FAIL'} (score: ${grade.score})`)
    
    // Step 3: Check if we're done
    if (grade.pass) {
      return {
        documentType: grade.documentType,
        confidence: grade.confidence,
        taxYear: extraction.fields['tax_year']?.value as number | null,
        issues: grade.issues,
        extractedFields: Object.fromEntries(
          Object.entries(extraction.fields)
            .filter(([_, v]) => v.value !== null)
            .map(([k, v]) => [k, v.value])
        ),
        attempts: attempt
      }
    }
    
    // Step 4: Prepare feedback for next attempt
    feedback = grade.feedback
    console.log(`[CLASSIFIER] Feedback: ${feedback.slice(0, 200)}...`)
  }
  
  // Exhausted attempts - return best effort with low confidence
  console.log(`[CLASSIFIER] Max attempts reached for ${fileName}`)
  
  return {
    documentType: lastGrade?.documentType || 'OTHER',
    confidence: Math.min(lastExtraction?.overallConfidence || 0.3, 0.5),
    taxYear: lastExtraction?.fields['tax_year']?.value as number | null,
    issues: [
      ...(lastGrade?.issues || []),
      '[WARNING:low_confidence::] Document could not be confidently classified after multiple attempts. Manual review recommended.'
    ],
    extractedFields: {},
    attempts: MAX_ATTEMPTS
  }
}
```

---

## Integration

Update `assessment-fast.ts` to use the new agentic classifier:

```typescript
// In runAssessmentFast():

// OLD:
const classification = await classifyWithOpenAI(extraction.markdown, fileName, engagement.taxYear)

// NEW:
const classification = await classifyDocumentAgentic(extraction.markdown, fileName, engagement.taxYear)

// The return shape is compatible, plus we now get extractedFields as a bonus
```

---

## Benefits

1. **Better accuracy**: Multiple attempts with feedback beats single-shot
2. **Catches blank forms**: Grader explicitly checks for all-null fields
3. **Structured data extraction**: We get actual field values, not just classification
4. **Debuggable**: Every attempt logged with reasoning and feedback
5. **Graceful degradation**: Clear escalation to human review
6. **Extensible**: Easy to add new form types by defining templates

---

## Testing Strategy

1. **Unit tests for grader rules**: Test each validation rule in isolation
2. **Integration tests with real forms**: W-2, 1099s, etc.
3. **Edge cases**: Blank forms, partial scans, wrong tax year
4. **Performance**: Ensure 3 attempts doesn't blow latency budget (add early-exit optimizations)

---

## Files to Create

1. `apps/api/src/lib/form-templates.ts` — Form schemas
2. `apps/api/src/lib/agents/extractor.ts` — Field extraction
3. `apps/api/src/lib/agents/grader.ts` — Quality validation
4. `apps/api/src/lib/agents/classifier-agent.ts` — Loop orchestrator
5. Update `apps/api/src/lib/agents/assessment-fast.ts` — Integration

---

## Open Questions

1. Should we cache extraction results between attempts? (probably yes)
2. ~~Should grader use LLM or be rule-based?~~ **DECIDED: LLM-based grader** (see below)
3. How to handle multi-page documents? (extract all pages, grade holistically)

---

## UPDATE: LLM-Based Grader

The grader should be **LLM-based**, not rule-based. This allows:
- Nuanced judgment ("this looks like a draft W-2, not final")
- Better feedback generation (natural language, context-aware)
- Catching edge cases rules would miss
- Easier to extend without code changes

### LLM Grader Prompt

```typescript
const GRADER_SYSTEM_PROMPT = `You are a tax document quality grader. Given an extraction attempt, evaluate whether it's good enough to accept.

You receive:
1. The extracted fields and their values
2. The OCR text for reference
3. The form template (expected fields)
4. The attempt number (1-3)

Your job:
1. **Validate each field** - Is the format correct? Does the value make sense?
2. **Check completeness** - Are the critical fields filled?
3. **Detect problems** - Blank form? Wrong year? Inconsistent data?
4. **Decide: PASS or FAIL**
5. **If FAIL, provide specific feedback** for the extractor to try again

GRADING CRITERIA:

PASS if:
- Document type is confidently identified
- At least 70% of required fields are filled with valid values
- No critical errors (wrong tax year, blank form)
- Confidence ≥ threshold for this form type

FAIL if:
- Can't determine document type
- Most required fields are empty/invalid
- Document appears to be blank template
- Tax year mismatch with expected year
- Data is internally inconsistent

FEEDBACK GUIDELINES (when FAIL):
- Be specific: "Box 1 shows '$-' which isn't a valid amount"
- Give location hints: "Look for employer EIN in the top-left, Box b"
- Escalate strategy on later attempts:
  - Attempt 2: "Consider if this might be a different form type"
  - Attempt 3: "Focus only on the most critical fields. If still unclear, classify as OTHER"

OUTPUT FORMAT:
{
  "pass": boolean,
  "score": number (0-100),
  "documentType": string (confirmed or corrected),
  "confidence": number (0-1),
  "fieldValidation": {
    "fieldName": { "valid": boolean, "issue": string | null }
  },
  "issues": ["[SEVERITY:type:expected:actual] Description"],
  "feedback": "Specific guidance for next attempt (if FAIL)",
  "reasoning": "Brief explanation of your decision"
}`
```

### Benefits of LLM Grader

1. **Contextual judgment** — "This W-2 has wages but no tax withheld... that's unusual but valid for low earners"
2. **Natural feedback** — Generates human-readable guidance, not robotic rule outputs
3. **Adaptable** — Handles weird edge cases without code changes
4. **Consistent with extractor** — Both use LLM, easier to reason about

### Keep Some Rules

Still use code-based validation for:
- Format regex (SSN, EIN) — fast, deterministic
- Tax year comparison — simple equality check
- Confidence threshold — numeric comparison

The LLM grader calls these helpers, but makes the final PASS/FAIL decision.
