import { prisma } from '../prisma.js'
import { classifyDocument as classifyWithOpenAI } from '../openai.js'
import { getStorageClient, type StorageProvider } from '../storage/index.js'
import { extractDocument, isSupportedFileType } from '../document-extraction.js'
import type { Document } from '../../types.js'

/**
 * Fast document assessment - direct function calls, no agent overhead.
 * ~3x faster than the agent-based approach.
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

  // Mark as processing (single write at start)
  documents[docIndex].processingStatus = 'downloading'
  documents[docIndex].processingStartedAt = new Date().toISOString()
  
  try {
    // 1. Download file
    const provider = (engagement.storageProvider || 'dropbox') as StorageProvider
    const client = getStorageClient(provider)
    
    const { buffer, mimeType, size } = await client.downloadFile(
      storageItemId,
      {
        driveId: engagement.storageDriveId || undefined,
        sharedLinkUrl: engagement.storageFolderUrl || undefined,
        fileName
      }
    )
    
    console.log(`[FAST] Downloaded ${fileName} (${size} bytes)`)

    if (!isSupportedFileType(mimeType)) {
      throw new Error(`Unsupported file type: ${mimeType}`)
    }

    // 2. OCR extraction (update status in memory, not DB)
    documents[docIndex].processingStatus = 'extracting'
    
    const base64 = buffer.toString('base64')
    const dataUri = `data:${mimeType};base64,${base64}`
    const extraction = await extractDocument(dataUri, buffer, mimeType)
    
    console.log(`[FAST] Extracted ${fileName} (${extraction.markdown.length} chars)`)

    // 3. Classification (update status in memory)
    documents[docIndex].processingStatus = 'classifying'
    
    const classification = await classifyWithOpenAI(
      extraction.markdown.slice(0, 10000),
      fileName,
      engagement.taxYear
    )
    
    console.log(`[FAST] Classified ${fileName}: ${classification.documentType} (${Math.round(classification.confidence * 100)}%)`)

    // 4. Single DB write with all updates
    documents[docIndex] = {
      ...documents[docIndex],
      documentType: classification.documentType,
      confidence: classification.confidence,
      taxYear: classification.taxYear,
      issues: classification.issues,
      classifiedAt: new Date().toISOString(),
      processingStatus: 'classified',
      processingStartedAt: null
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
