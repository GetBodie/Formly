/**
 * Tests for the Agentic Classifier (Claude Vision with OCR Tool)
 * 
 * Note: Full integration tests require actual Claude API calls.
 * These tests cover the helper functions and minimal content handling.
 */

import { describe, it, expect } from 'vitest'
import { 
  classifyDocumentAgentic, 
  classifyDocumentFromText,
  type ClassificationResult,
  type DocumentImage 
} from '../classifier-agent.js'

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Create a minimal DocumentImage for testing
 */
function createTestImage(base64Content = ''): DocumentImage {
  return {
    base64: base64Content,
    mimeType: 'image/png'
  }
}

// ============================================
// VISION-BASED CLASSIFICATION
// ============================================

describe('classifyDocumentAgentic (vision)', () => {
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

      // Check all required properties exist
      expect(result).toHaveProperty('documentType')
      expect(result).toHaveProperty('confidence')
      expect(result).toHaveProperty('taxYear')
      expect(result).toHaveProperty('issues')
      expect(result).toHaveProperty('extractedFields')
      expect(result).toHaveProperty('needsHumanReview')

      // Check types
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
// TEXT-BASED CLASSIFICATION (LEGACY)
// ============================================

describe('classifyDocumentFromText (legacy)', () => {
  describe('Minimal Content Handling', () => {
    it('should return early with low confidence for minimal content', async () => {
      const result = await classifyDocumentFromText('short text', 'tiny.pdf', 2024)

      expect(result.documentType).toBe('OTHER')
      expect(result.confidence).toBeLessThanOrEqual(0.5)
      expect(result.issues.some(i => i.includes('minimal content') || i.includes('blank'))).toBe(true)
      expect(result.needsHumanReview).toBe(true)
    })

    it('should return early for empty string', async () => {
      const result = await classifyDocumentFromText('', 'empty.pdf', 2024)

      expect(result.documentType).toBe('OTHER')
      expect(result.confidence).toBeLessThanOrEqual(0.5)
      expect(result.needsHumanReview).toBe(true)
    })

    it('should return early for whitespace-only content', async () => {
      const result = await classifyDocumentFromText('   \n\t\n   ', 'whitespace.pdf', 2024)

      expect(result.documentType).toBe('OTHER')
      expect(result.confidence).toBeLessThanOrEqual(0.5)
    })
  })

  describe('Result Structure', () => {
    it('should return expected properties', async () => {
      const result = await classifyDocumentFromText('', 'test.pdf', 2024)

      // Check all required properties exist
      expect(result).toHaveProperty('documentType')
      expect(result).toHaveProperty('confidence')
      expect(result).toHaveProperty('taxYear')
      expect(result).toHaveProperty('issues')
      expect(result).toHaveProperty('extractedFields')
      expect(result).toHaveProperty('needsHumanReview')

      // Check types
      expect(typeof result.documentType).toBe('string')
      expect(typeof result.confidence).toBe('number')
      expect(Array.isArray(result.issues)).toBe(true)
      expect(typeof result.extractedFields).toBe('object')
      expect(typeof result.needsHumanReview).toBe('boolean')
    })

    it('should have confidence between 0 and 1', async () => {
      const result = await classifyDocumentFromText('', 'test.pdf')
      expect(result.confidence).toBeGreaterThanOrEqual(0)
      expect(result.confidence).toBeLessThanOrEqual(1)
    })
  })
})

// ============================================
// TYPE EXPORTS
// ============================================

describe('Type Exports', () => {
  it('should export ClassificationResult type', () => {
    // This test verifies the type is correctly exported
    // TypeScript will fail compilation if the type doesn't match
    const result: ClassificationResult = {
      documentType: 'W-2',
      confidence: 0.9,
      taxYear: 2024,
      issues: [],
      extractedFields: { wages: 50000 },
      needsHumanReview: false
    }
    
    expect(result.documentType).toBe('W-2')
    expect(result.needsHumanReview).toBe(false)
  })

  it('should export DocumentImage type', () => {
    const image: DocumentImage = {
      base64: 'dGVzdA==',
      mimeType: 'image/png',
      presignedUrl: 'https://example.com/doc.pdf'
    }
    
    expect(image.base64).toBe('dGVzdA==')
    expect(image.mimeType).toBe('image/png')
    expect(image.presignedUrl).toBe('https://example.com/doc.pdf')
  })
})

// ============================================
// NOTE: Full integration tests with Claude API
// should be run separately with ANTHROPIC_API_KEY set.
// ============================================
