import { Client } from '@microsoft/microsoft-graph-client'
import { ClientSecretCredential } from '@azure/identity'
import { TokenCredentialAuthenticationProvider } from '@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials/index.js'

let client: Client | null = null

// Custom error for file size validation
export class DocumentTooLargeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DocumentTooLargeError'
  }
}

// Maximum file size: 25MB
const MAX_FILE_SIZE = 25 * 1024 * 1024

export interface DownloadResult {
  buffer: Buffer
  presignedUrl: string
  mimeType: string
  fileName: string
  size: number
}

function getClient(): Client {
  if (!client) {
    const credential = new ClientSecretCredential(
      process.env.AZURE_TENANT_ID!,
      process.env.AZURE_CLIENT_ID!,
      process.env.AZURE_CLIENT_SECRET!
    )
    const authProvider = new TokenCredentialAuthenticationProvider(credential, {
      scopes: ['https://graph.microsoft.com/.default'],
    })
    client = Client.initWithMiddleware({ authProvider })
  }
  return client
}

export async function syncFolder(driveId: string, folderId: string, deltaLink: string | null) {
  const c = getClient()
  const url = deltaLink || `/drives/${driveId}/items/${folderId}/delta`

  const response = await c.api(url).get()

  return {
    items: response.value as Array<{ id?: string; name?: string; file?: { mimeType: string }; deleted?: boolean }>,
    newDeltaLink: response['@odata.deltaLink'] || null,
  }
}

export async function downloadFile(driveId: string, itemId: string): Promise<DownloadResult> {
  const c = getClient()

  // Get item metadata including presigned URL
  const item = await c
    .api(`/drives/${driveId}/items/${itemId}`)
    .select('name,size,file,@microsoft.graph.downloadUrl')
    .get()

  const presignedUrl = item['@microsoft.graph.downloadUrl']
  const mimeType = item.file?.mimeType || 'application/octet-stream'
  const fileName = item.name
  const size = item.size

  // Validate file size
  if (size > MAX_FILE_SIZE) {
    throw new DocumentTooLargeError(
      `File ${fileName} is ${(size / 1024 / 1024).toFixed(1)}MB, ` +
        `exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit. Please compress and re-upload.`
    )
  }

  // Download the actual file
  const response = await fetch(presignedUrl)
  const buffer = Buffer.from(await response.arrayBuffer())

  return {
    buffer,
    presignedUrl,
    mimeType,
    fileName,
    size,
  }
}

export async function resolveSharePointUrl(url: string): Promise<{ driveId: string; folderId: string } | null> {
  const c = getClient()
  try {
    const encoded = Buffer.from(url).toString('base64')
    const response = await c.api(`/shares/u!${encoded}/driveItem`).get()
    return { driveId: response.parentReference.driveId, folderId: response.id }
  } catch {
    return null
  }
}
