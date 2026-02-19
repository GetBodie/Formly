import { prisma } from '../prisma.js'
import { classifyDocumentAgentic, type DocumentImage } from './classifier-agent.js'
import { getStorageClient, type StorageProvider } from '../storage/index.js'
import { FileNotFoundError } from '../storage/types.js'
import { isSupportedFileType } from '../document-extraction.js'

// Processing timeout: 5 minutes max per document
const PROCESSING_TIMEOUT_MS = 5 * 60 * 1000
const MAX_RETRY_COUNT = 3

function withTimeout<T>(promise: Promise<T>, ms: number, operation: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout: ${operation} exceeded ${ms / 1000}s`)), ms)
    )
  ])
}

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

  const doc = await prisma.document.findUnique({
    where: { id: documentId }
  })

  if (!doc) {
    throw new Error(`Document ${documentId} not found`)
  }

  // Check retry count - fail permanently if exceeded
  if (doc.retryCount >= MAX_RETRY_COUNT) {
    console.log(`[FAST] Document ${documentId} exceeded max retries (${MAX_RETRY_COUNT}), marking as permanent error`)
    await prisma.document.update({
      where: { id: documentId },
      data: {
        processingStatus: 'error',
        issues: [`Processing failed after ${MAX_RETRY_COUNT} attempts. Please re-upload the document.`]
      }
    })
    return { hasIssues: true, documentType: 'PENDING' }
  }

  // Mark as downloading and increment retry count
  await prisma.document.update({
    where: { id: documentId },
    data: {
      processingStatus: 'downloading',
      processingStartedAt: new Date(),
      retryCount: { increment: 1 }
    }
  })

  try {
    // 1. Download file (with timeout)
    const provider = (engagement.storageProvider || 'dropbox') as StorageProvider
    const client = getStorageClient(provider)

    const { buffer, mimeType, size, presignedUrl } = await withTimeout(
      client.downloadFile(
        storageItemId,
        {
          driveId: engagement.storageDriveId || undefined,
          sharedLinkUrl: engagement.storageFolderUrl || undefined,
          fileName
        }
      ),
      PROCESSING_TIMEOUT_MS / 3,
      `download ${fileName}`
    )

    console.log(`[FAST] Downloaded ${fileName} (${size} bytes)`)

    if (!isSupportedFileType(mimeType)) {
      throw new Error(`Unsupported file type: ${mimeType}`)
    }

    // 2. Mark as classifying
    await prisma.document.update({
      where: { id: documentId },
      data: { processingStatus: 'classifying' }
    })

    const base64 = buffer.toString('base64')
    const documentImage: DocumentImage = {
      base64,
      mimeType,
      presignedUrl
    }

    console.log(`[FAST] Sending ${fileName} to classifier (${Math.round(size / 1024)}KB, ${mimeType})`)

    // 3. Classification with vision + optional OCR tool
    const classification = await withTimeout(
      classifyDocumentAgentic(
        documentImage,
        fileName,
        engagement.taxYear
      ),
      PROCESSING_TIMEOUT_MS * 0.8,
      `classification ${fileName}`
    )

    console.log(`[FAST] Classified ${fileName}: ${classification.documentType} (${Math.round(classification.confidence * 100)}%)${classification.needsHumanReview ? ' [NEEDS REVIEW]' : ''}`)

    // 4. Update document with classification results
    await prisma.document.update({
      where: { id: documentId },
      data: {
        documentType: classification.documentType,
        confidence: classification.confidence,
        taxYear: classification.taxYear,
        issues: classification.issues,
        classifiedAt: new Date(),
        processingStatus: 'classified',
        processingStartedAt: null,
        retryCount: 0
      }
    })

    await prisma.engagement.update({
      where: { id: engagementId },
      data: { lastActivityAt: new Date() }
    })

    return {
      hasIssues: classification.issues.length > 0,
      documentType: classification.documentType
    }

  } catch (error) {
    // If the file was deleted/moved from storage, archive it instead of retrying
    if (error instanceof FileNotFoundError) {
      console.log(`[FAST] File not found in storage, archiving document ${documentId}: ${fileName}`)
      await prisma.document.update({
        where: { id: documentId },
        data: {
          processingStatus: 'error',
          processingStartedAt: null,
          archivedAt: new Date(),
          archivedReason: 'File deleted or moved from storage provider',
        }
      })
      return { hasIssues: true, documentType: 'PENDING' }
    }

    console.error(`[FAST] Error processing ${fileName}:`, error)

    await prisma.document.update({
      where: { id: documentId },
      data: {
        processingStatus: 'error',
        processingStartedAt: null
      }
    })

    throw error
  }
}
