import { prisma } from '../prisma.js'
import { classifyDocumentAgentic } from './classifier-agent.js'
import { getStorageClient, type StorageProvider } from '../storage/index.js'
import { extractDocument, isSupportedFileType } from '../document-extraction.js'
import type { Document } from '../../types.js'

// Processing timeout: 5 minutes max per document
const PROCESSING_TIMEOUT_MS = 5 * 60 * 1000
const MAX_RETRY_COUNT = 3

/**
 * Wrap a promise with a timeout. Rejects with TimeoutError if exceeded.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, operation: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout: ${operation} exceeded ${ms / 1000}s`)), ms)
    )
  ])
}

/**
 * Fast document assessment - direct function calls, no agent overhead.
 * ~3x faster than the agent-based approach.
 * Includes timeout enforcement (5 min max) and retry count tracking.
 */
export async function runAssessmentFast(context: {
  engagementId: string
  documentId: string
  storageItemId: string
  fileName: string
}): Promise<{ hasIssues: boolean; documentType: string }> {
  const { engagementId, documentId, storageItemId, fileName } = context
  
  const engagement = await prisma.engagement.findUnique({
    where: { id: engagementId }
  })

  if (!engagement) {
    throw new Error(`Engagement ${engagementId} not found`)
  }

  const documents = (engagement.documents as Document[] | null) ?? []
  const docIndex = documents.findIndex(d => d.id === documentId)
  
  if (docIndex === -1) {
    throw new Error(`Document ${documentId} not found`)
  }

  // Check retry count - fail permanently if exceeded
  const currentRetryCount = documents[docIndex].retryCount || 0
  if (currentRetryCount >= MAX_RETRY_COUNT) {
    console.log(`[FAST] Document ${documentId} exceeded max retries (${MAX_RETRY_COUNT}), marking as permanent error`)
    documents[docIndex].processingStatus = 'error'
    documents[docIndex].issues = [`Processing failed after ${MAX_RETRY_COUNT} attempts. Please re-upload the document.`]
    await prisma.engagement.update({
      where: { id: engagementId },
      data: { documents }
    })
    return { hasIssues: true, documentType: 'PENDING' }
  }

  // Mark as processing and increment retry count
  documents[docIndex].processingStatus = 'downloading'
  documents[docIndex].processingStartedAt = new Date().toISOString()
  documents[docIndex].retryCount = currentRetryCount + 1
  
  try {
    // 1. Download file (with timeout)
    const provider = (engagement.storageProvider || 'dropbox') as StorageProvider
    const client = getStorageClient(provider)
    
    const { buffer, mimeType, size } = await withTimeout(
      client.downloadFile(
        storageItemId,
        {
          driveId: engagement.storageDriveId || undefined,
          sharedLinkUrl: engagement.storageFolderUrl || undefined,
          fileName
        }
      ),
      PROCESSING_TIMEOUT_MS / 3, // Allow ~1.6 min for download
      `download ${fileName}`
    )
    
    console.log(`[FAST] Downloaded ${fileName} (${size} bytes)`)

    if (!isSupportedFileType(mimeType)) {
      throw new Error(`Unsupported file type: ${mimeType}`)
    }

    // 2. OCR extraction with timeout (update status in memory, not DB)
    documents[docIndex].processingStatus = 'extracting'
    
    const base64 = buffer.toString('base64')
    const dataUri = `data:${mimeType};base64,${base64}`
    const extraction = await withTimeout(
      extractDocument(dataUri, buffer, mimeType),
      PROCESSING_TIMEOUT_MS / 2, // Allow ~2.5 min for OCR
      `OCR extraction ${fileName}`
    )
    
    console.log(`[FAST] Extracted ${fileName} (${extraction.markdown.length} chars)`)

    // 3. Classification with timeout (update status in memory)
    // Uses agentic loop: extract → grade → feedback → retry (max 3 attempts)
    documents[docIndex].processingStatus = 'classifying'
    
    const classification = await withTimeout(
      classifyDocumentAgentic(
        extraction.markdown.slice(0, 15000), // Increased limit for better extraction
        fileName,
        engagement.taxYear
      ),
      PROCESSING_TIMEOUT_MS / 2, // Allow more time for agentic loop (~2.5 min)
      `classification ${fileName}`
    )
    
    console.log(`[FAST] Classified ${fileName}: ${classification.documentType} (${Math.round(classification.confidence * 100)}%) after ${classification.attempts} attempt(s)`)

    // 4. Single DB write with all updates (clear retry count on success)
    documents[docIndex] = {
      ...documents[docIndex],
      documentType: classification.documentType,
      confidence: classification.confidence,
      taxYear: classification.taxYear,
      issues: classification.issues,
      classifiedAt: new Date().toISOString(),
      processingStatus: 'classified',
      processingStartedAt: null,
      retryCount: 0 // Reset on success
    }

    await prisma.engagement.update({
      where: { id: engagementId },
      data: {
        documents,
        lastActivityAt: new Date()
      }
    })

    return {
      hasIssues: classification.issues.length > 0,
      documentType: classification.documentType
    }

  } catch (error) {
    console.error(`[FAST] Error processing ${fileName}:`, error)
    
    // Mark as error (single write)
    documents[docIndex].processingStatus = 'error'
    documents[docIndex].processingStartedAt = null
    
    await prisma.engagement.update({
      where: { id: engagementId },
      data: { documents }
    })
    
    throw error
  }
}
