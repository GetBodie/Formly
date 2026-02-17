/**
 * Tests for the Classifier Agent (Two-level reflection with Claude Opus)
 *
 * Note: Full integration tests require actual API calls (Claude + OpenAI).
 * These tests cover: helper functions, invalid input handling, type exports,
 * and mocked gradeWithLLM behavior.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  classifyDocumentAgentic,
  gradeWithLLM,
  type ClassificationResult,
  type DocumentImage,
} from '../classifier-agent.js'

// ============================================
// MOCKS
// ============================================

const { mockParse, MockOpenAI } = vi.hoisted(() => {
  const mockParse = vi.fn()
  class MockOpenAI {
    chat = {
      completions: {
        parse: mockParse,
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content: 'OCR text' } }],
        }),
      },
    }
  }
  return { mockParse, MockOpenAI }
})

vi.mock('openai', () => ({
  default: MockOpenAI,
}))

vi.mock('openai/helpers/zod', () => ({
  zodResponseFormat: vi.fn((schema, name) => ({
    type: 'json_schema',
    json_schema: { name },
  })),
}))

// ============================================
// HELPERS
// ============================================

function createTestImage(base64Content = ''): DocumentImage {
  return {
    base64: base64Content,
    mimeType: 'image/png',
  }
}

// ============================================
// INVALID/EMPTY INPUT HANDLING
// ============================================

describe('classifyDocumentAgentic', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetAllMocks()
  })

  describe('Invalid/Empty Image Handling', () => {
    it('should return early with low confidence for empty base64', async () => {
      const result = await classifyDocumentAgentic(
        createTestImage(''),
        'empty.png',
        2024
      )

      expect(result.documentType).toBe('OTHER')
      expect(result.confidence).toBeLessThanOrEqual(0.5)
      expect(result.issues.some(i => i.includes('invalid') || i.includes('empty'))).toBe(true)
      expect(result.needsHumanReview).toBe(true)
    })

    it('should return early for very short base64 content', async () => {
      const result = await classifyDocumentAgentic(
        createTestImage('abc'),
        'tiny.png',
        2024
      )

      expect(result.documentType).toBe('OTHER')
      expect(result.confidence).toBeLessThanOrEqual(0.5)
      expect(result.needsHumanReview).toBe(true)
    })
  })

  describe('Result Structure', () => {
    it('should return expected properties', async () => {
      const result = await classifyDocumentAgentic(
        createTestImage(''),
        'test.png',
        2024
      )

      expect(result).toHaveProperty('documentType')
      expect(result).toHaveProperty('confidence')
      expect(result).toHaveProperty('taxYear')
      expect(result).toHaveProperty('issues')
      expect(result).toHaveProperty('extractedFields')
      expect(result).toHaveProperty('needsHumanReview')

      expect(typeof result.documentType).toBe('string')
      expect(typeof result.confidence).toBe('number')
      expect(Array.isArray(result.issues)).toBe(true)
      expect(typeof result.extractedFields).toBe('object')
      expect(typeof result.needsHumanReview).toBe('boolean')
    })

    it('should have confidence between 0 and 1', async () => {
      const result = await classifyDocumentAgentic(
        createTestImage(''),
        'test.png'
      )
      expect(result.confidence).toBeGreaterThanOrEqual(0)
      expect(result.confidence).toBeLessThanOrEqual(1)
    })
  })
})

// ============================================
// GRADING FUNCTION
// ============================================

describe('gradeWithLLM', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetAllMocks()
  })

  it('should return a grade with all required fields', async () => {
    mockParse.mockResolvedValueOnce({
      choices: [{
        message: {
          parsed: {
            score: 0.92,
            issues: [],
            likely_correct_type: true,
            suggestion: 'All fields present',
            retry_instructions: 'No changes needed.',
          },
        },
      }],
    })

    const grade = await gradeWithLLM(
      { employer_name: 'Acme Corp', wages_box1: 50000, tax_year: 2024 },
      'W-2'
    )

    expect(grade.score).toBe(0.92)
    expect(grade.likely_correct_type).toBe(true)
    expect(grade.issues).toEqual([])
    expect(grade.retry_instructions).toBeTruthy()
  })

  it('should return low score for empty fields', async () => {
    mockParse.mockResolvedValueOnce({
      choices: [{
        message: {
          parsed: {
            score: 0.2,
            issues: ['[WARNING:incomplete::] Document appears to be a blank form'],
            likely_correct_type: true,
            suggestion: 'Blank form detected',
            retry_instructions: 'Check if document has any filled values.',
          },
        },
      }],
    })

    const grade = await gradeWithLLM(
      { employer_name: null, wages_box1: null, tax_year: null },
      'W-2'
    )

    expect(grade.score).toBeLessThan(0.5)
    expect(grade.issues.length).toBeGreaterThan(0)
  })

  it('should indicate wrong type when fields do not match', async () => {
    mockParse.mockResolvedValueOnce({
      choices: [{
        message: {
          parsed: {
            score: 0.3,
            issues: ['[ERROR:wrong_type:W-2:1099-NEC] Fields suggest this is a 1099-NEC'],
            likely_correct_type: false,
            suggestion: 'Try classifying as 1099-NEC',
            retry_instructions: 'This appears to be a 1099-NEC, not a W-2. Look for box 1 nonemployee compensation.',
          },
        },
      }],
    })

    const grade = await gradeWithLLM(
      { payer_name: 'Client Inc', nonemployee_compensation_box1: 15000 },
      'W-2'
    )

    expect(grade.likely_correct_type).toBe(false)
    expect(grade.score).toBeLessThan(0.5)
  })

  it('should return fallback grade when parse fails', async () => {
    mockParse.mockResolvedValueOnce({
      choices: [{ message: { parsed: null } }],
    })

    const grade = await gradeWithLLM({ some_field: 'value' }, 'OTHER')

    expect(grade.score).toBe(0.5)
    expect(grade.issues.some(i => i.includes('parse_error'))).toBe(true)
  })
})

// ============================================
// TYPE EXPORTS
// ============================================

describe('Type Exports', () => {
  it('should export ClassificationResult type', () => {
    const result: ClassificationResult = {
      documentType: 'W-2',
      confidence: 0.9,
      taxYear: 2024,
      issues: [],
      extractedFields: { wages: 50000 },
      needsHumanReview: false,
    }

    expect(result.documentType).toBe('W-2')
    expect(result.needsHumanReview).toBe(false)
  })

  it('should export DocumentImage type', () => {
    const image: DocumentImage = {
      base64: 'dGVzdA==',
      mimeType: 'image/png',
      presignedUrl: 'https://example.com/doc.pdf',
    }

    expect(image.base64).toBe('dGVzdA==')
    expect(image.mimeType).toBe('image/png')
    expect(image.presignedUrl).toBe('https://example.com/doc.pdf')
  })
})
