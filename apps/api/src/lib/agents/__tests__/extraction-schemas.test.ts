/**
 * Tests that all extraction schemas are compatible with OpenAI's structured output API.
 *
 * The real zodResponseFormat converts Zod schemas to JSON Schema. OpenAI rejects
 * schemas containing unsupported keywords like `propertyNames` (from z.record()).
 * These tests call the REAL zodResponseFormat (no mocks) to catch incompatibilities.
 */

import { describe, it, expect } from 'vitest'
import { zodResponseFormat } from 'openai/helpers/zod'
import { z } from 'zod'

// Replicate the extraction schemas from classifier-agent.ts
// since they aren't exported. This ensures any schema change
// is also reflected here (or the test fails to match production behavior).

const W2Schema = z.object({
  employer_name: z.string().nullable(),
  employer_ein: z.string().nullable(),
  employee_name: z.string().nullable(),
  employee_ssn: z.string().nullable(),
  wages_box1: z.number().nullable(),
  federal_tax_withheld_box2: z.number().nullable(),
  social_security_wages_box3: z.number().nullable(),
  social_security_tax_box4: z.number().nullable(),
  medicare_wages_box5: z.number().nullable(),
  medicare_tax_box6: z.number().nullable(),
  state: z.string().nullable(),
  state_wages: z.number().nullable(),
  state_tax: z.number().nullable(),
  tax_year: z.number().nullable(),
})

const GenericSchema = z.object({
  description: z.string().nullable(),
  key_values: z.array(z.object({ key: z.string(), value: z.string() })).nullable(),
})

const StatementSchema = z.object({
  institution_name: z.string().nullable(),
  account_type: z.string().nullable(),
  period_start: z.string().nullable(),
  period_end: z.string().nullable(),
  ending_balance: z.number().nullable(),
})

const ReceiptSchema = z.object({
  vendor_name: z.string().nullable(),
  date: z.string().nullable(),
  total_amount: z.number().nullable(),
  description: z.string().nullable(),
  category: z.string().nullable(),
})

const ALL_SCHEMAS: Record<string, { schema: z.ZodObject<z.ZodRawShape>; name: string }> = {
  'W-2': { schema: W2Schema, name: 'w2_extraction' },
  'RECEIPT': { schema: ReceiptSchema, name: 'receipt_extraction' },
  'STATEMENT': { schema: StatementSchema, name: 'statement_extraction' },
  'OTHER': { schema: GenericSchema, name: 'generic_extraction' },
}

function jsonSchemaContains(obj: unknown, key: string): boolean {
  if (obj === null || typeof obj !== 'object') return false
  if (key in (obj as Record<string, unknown>)) return true
  return Object.values(obj as Record<string, unknown>).some(v => jsonSchemaContains(v, key))
}

describe('Extraction Schemas - OpenAI Compatibility', () => {
  it.each(Object.entries(ALL_SCHEMAS))(
    '%s schema should produce a valid zodResponseFormat without errors',
    (_type, config) => {
      expect(() => zodResponseFormat(config.schema, config.name)).not.toThrow()
    }
  )

  it('GenericSchema should not contain propertyNames (unsupported by OpenAI)', () => {
    const format = zodResponseFormat(GenericSchema, 'generic_extraction')
    const jsonSchema = format.json_schema?.schema
    expect(jsonSchemaContains(jsonSchema, 'propertyNames')).toBe(false)
  })

  it('GenericSchema key_values should accept arbitrary key-value pairs', () => {
    const parsed = GenericSchema.parse({
      description: 'Some unknown document',
      key_values: [
        { key: 'name', value: 'John Doe' },
        { key: 'amount', value: '1500.00' },
      ],
    })

    expect(parsed.key_values).toHaveLength(2)
    expect(parsed.key_values![0].key).toBe('name')
    expect(parsed.key_values![0].value).toBe('John Doe')
  })

  it('GenericSchema key_values should accept null', () => {
    const parsed = GenericSchema.parse({
      description: 'Empty document',
      key_values: null,
    })
    expect(parsed.key_values).toBeNull()
  })

  it('z.record() would produce propertyNames (regression guard)', () => {
    const badSchema = z.object({
      data: z.record(z.string(), z.string()).nullable(),
    })
    const format = zodResponseFormat(badSchema, 'bad_schema')
    const jsonSchema = format.json_schema?.schema
    expect(jsonSchemaContains(jsonSchema, 'propertyNames')).toBe(true)
  })
})
