import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { getStorageClient, detectProvider } from '@/lib/storage'
import { dispatch } from '@/lib/agents/dispatcher'

const CreateEngagementSchema = z.object({
  clientName: z.string().min(1),
  clientEmail: z.string().email(),
  taxYear: z.number().int().min(2020).max(2030),
  storageFolderUrl: z.string().url(),
  // Legacy field - accept but prefer storageFolderUrl
  sharepointFolderUrl: z.string().url().optional(),
  typeformFormId: z.string().min(1),
})

export async function GET() {
  const engagements = await prisma.engagement.findMany({
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json(engagements)
}

export async function POST(request: NextRequest) {
  const body = await request.json()

  const parsed = CreateEngagementSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  // Use storageFolderUrl, fallback to legacy sharepointFolderUrl
  const folderUrl = parsed.data.storageFolderUrl || parsed.data.sharepointFolderUrl!

  // Detect provider from URL
  const provider = detectProvider(folderUrl)
  if (!provider) {
    return NextResponse.json(
      { error: 'Unsupported storage URL. Use SharePoint or Google Drive.' },
      { status: 400 }
    )
  }

  // Resolve URL to folder IDs
  let storageFolderId: string | null = null
  let storageDriveId: string | null = null

  try {
    const client = getStorageClient(provider)
    const resolved = await client.resolveUrl(folderUrl)
    if (resolved) {
      storageFolderId = resolved.folderId
      storageDriveId = resolved.driveId || null
    }
  } catch (error) {
    console.warn('Could not resolve storage URL:', error)
    // Continue without resolved IDs - they can be set later
  }

  const engagement = await prisma.engagement.create({
    data: {
      clientName: parsed.data.clientName,
      clientEmail: parsed.data.clientEmail,
      taxYear: parsed.data.taxYear,
      typeformFormId: parsed.data.typeformFormId,
      // New storage fields
      storageProvider: provider,
      storageFolderUrl: folderUrl,
      storageFolderId,
      storageDriveId,
      // Legacy fields (for backwards compatibility)
      sharepointFolderUrl: provider === 'sharepoint' ? folderUrl : null,
      sharepointDriveId: provider === 'sharepoint' ? storageDriveId : null,
      sharepointFolderId: provider === 'sharepoint' ? storageFolderId : null,
    },
  })

  // Trigger Outreach Agent to send welcome email
  waitUntil(dispatch({
    type: 'engagement_created',
    engagementId: engagement.id
  }))

  return NextResponse.json(engagement, { status: 201 })
}
