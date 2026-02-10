/**
 * Integration tests for the Agentic Classifier
 * Tests the minimal content handling and error resilience
 * 
 * Note: Tests that require mocking the OpenAI API are skipped in unit tests.
 * Full integration testing should be done with actual API calls or E2E tests.
 */

import { describe, it, expect } from 'vitest'
import { classifyDocumentAgentic } from '../classifier-agent.js'
import { isMinimalContent, detectLikelyTypeFromFilename } from '../extractor.js'

// ============================================
// MOCK OCR TEXT FOR VARIOUS DOCUMENTS
// ============================================

const MINIMAL_CONTENT = `
Page 1
Some text
`

// ============================================
// UNIT TESTS FOR HELPER FUNCTIONS
// ============================================

describe('Extractor Helpers', () => {
  describe('isMinimalContent', () => {
    it('should return true for very short content', () => {
      expect(isMinimalContent('short')).toBe(true)
      expect(isMinimalContent('   ')).toBe(true)
      expect(isMinimalContent('')).toBe(true)
    })

    it('should return false for content >= 100 chars', () => {
      const longContent = 'a'.repeat(100)
      expect(isMinimalContent(longContent)).toBe(false)
    })

    it('should handle whitespace-only content', () => {
      expect(isMinimalContent('   \n\t   ')).toBe(true)
    })
  })

  describe('detectLikelyTypeFromFilename', () => {
    it('should detect W-2 from filename', () => {
      expect(detectLikelyTypeFromFilename('W-2_2024.pdf')).toBe('W-2')
      expect(detectLikelyTypeFromFilename('my_w2.pdf')).toBe('W-2')
      expect(detectLikelyTypeFromFilename('W2-employer.pdf')).toBe('W-2')
    })

    it('should detect 1099 forms from filename', () => {
      expect(detectLikelyTypeFromFilename('1099-NEC_2024.pdf')).toBe('1099-NEC')
      expect(detectLikelyTypeFromFilename('1099-int-bank.pdf')).toBe('1099-INT')
      expect(detectLikelyTypeFromFilename('1099div_vanguard.pdf')).toBe('1099-DIV')
      expect(detectLikelyTypeFromFilename('1099-MISC.pdf')).toBe('1099-MISC')
      expect(detectLikelyTypeFromFilename('1099B_schwab.pdf')).toBe('1099-B')
      expect(detectLikelyTypeFromFilename('1099r_retirement.pdf')).toBe('1099-R')
    })

    it('should detect K-1 from filename', () => {
      expect(detectLikelyTypeFromFilename('K-1_partnership.pdf')).toBe('K-1')
      expect(detectLikelyTypeFromFilename('schedule-k1.pdf')).toBe('K-1')
      expect(detectLikelyTypeFromFilename('k1_2024.pdf')).toBe('K-1')
    })

    it('should detect receipt/statement from filename', () => {
      expect(detectLikelyTypeFromFilename('receipt_amazon.pdf')).toBe('RECEIPT')
      expect(detectLikelyTypeFromFilename('bank_statement.pdf')).toBe('STATEMENT')
    })

    it('should return null for unknown filenames', () => {
      expect(detectLikelyTypeFromFilename('random_document.pdf')).toBe(null)
      expect(detectLikelyTypeFromFilename('photo.jpg')).toBe(null)
    })
  })
})

// ============================================
// INTEGRATION TESTS FOR MINIMAL CONTENT HANDLING
// ============================================

describe('classifyDocumentAgentic', () => {
  describe('Minimal Content Handling', () => {
    it('should return early with low confidence for minimal content', async () => {
      const result = await classifyDocumentAgentic(MINIMAL_CONTENT, 'tiny.pdf', 2024)

      expect(result.documentType).toBe('OTHER')
      expect(result.confidence).toBeLessThanOrEqual(0.5)
      expect(result.issues.some(i => i.includes('minimal content'))).toBe(true)
      expect(result.attempts).toBe(0)
    })

    it('should return early with low confidence for empty string', async () => {
      const result = await classifyDocumentAgentic('', 'empty.pdf', 2024)

      expect(result.documentType).toBe('OTHER')
      expect(result.confidence).toBeLessThanOrEqual(0.5)
      expect(result.attempts).toBe(0)
    })

    it('should return early for whitespace-only content', async () => {
      const result = await classifyDocumentAgentic('   \n\t\n   ', 'whitespace.pdf', 2024)

      expect(result.documentType).toBe('OTHER')
      expect(result.confidence).toBeLessThanOrEqual(0.5)
      expect(result.attempts).toBe(0)
    })
  })

  describe('Result Structure', () => {
    it('should return expected properties for minimal content', async () => {
      const result = await classifyDocumentAgentic('', 'test.pdf', 2024)

      expect(result).toHaveProperty('documentType')
      expect(result).toHaveProperty('confidence')
      expect(result).toHaveProperty('taxYear')
      expect(result).toHaveProperty('issues')
      expect(result).toHaveProperty('extractedFields')
      expect(result).toHaveProperty('attempts')

      expect(typeof result.documentType).toBe('string')
      expect(typeof result.confidence).toBe('number')
      expect(Array.isArray(result.issues)).toBe(true)
      expect(typeof result.extractedFields).toBe('object')
      expect(typeof result.attempts).toBe('number')
    })

    it('should return null taxYear when no content', async () => {
      const result = await classifyDocumentAgentic('', 'test.pdf', 2024)
      expect(result.taxYear).toBe(null)
    })

    it('should return empty extractedFields when no content', async () => {
      const result = await classifyDocumentAgentic('', 'test.pdf', 2024)
      expect(result.extractedFields).toEqual({})
    })
  })
})

// ============================================
// NOTE: Full integration tests with real OCR text
// require actual OpenAI API calls and should be
// run separately as E2E tests, not unit tests.
// ============================================
