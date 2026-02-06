import { useState, useMemo } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { createEngagement } from '../api/client'

type StorageProvider = 'sharepoint' | 'google-drive' | 'dropbox'

/**
 * Detect storage provider from URL (mirrors backend detectProvider)
 */
function detectProvider(url: string): StorageProvider | null {
  if (url.includes('sharepoint.com') || url.includes('onedrive.com')) {
    return 'sharepoint'
  }
  if (url.includes('drive.google.com')) {
    return 'google-drive'
  }
  if (url.includes('dropbox.com')) {
    return 'dropbox'
  }
  return null
}

const PROVIDER_LABELS: Record<StorageProvider, string> = {
  'sharepoint': 'SharePoint/OneDrive',
  'google-drive': 'Google Drive',
  'dropbox': 'Dropbox',
}

export default function NewEngagement() {
  const navigate = useNavigate()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [storageFolderUrl, setStorageFolderUrl] = useState('')

  const detectedProvider = useMemo(() => detectProvider(storageFolderUrl), [storageFolderUrl])

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setIsSubmitting(true)
    setError(null)

    const formData = new FormData(e.currentTarget)
    const data = {
      clientName: formData.get('clientName') as string,
      clientEmail: formData.get('clientEmail') as string,
      storageFolderUrl: formData.get('storageFolderUrl') as string,
    }

    try {
      const engagement = await createEngagement(data)
      navigate(`/engagements/${engagement.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-2xl mx-auto p-6">
        <div className="mb-6">
          <Link to="/" className="text-blue-600 hover:underline">
            &larr; Back to Dashboard
          </Link>
        </div>

        <div className="bg-white p-8 rounded-lg border">
          <h1 className="text-2xl font-bold mb-6">Start New Collection</h1>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label htmlFor="clientName" className="block text-sm font-medium text-gray-700 mb-2">
                Client Name
              </label>
              <input
                type="text"
                id="clientName"
                name="clientName"
                required
                className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="John Smith"
              />
            </div>

            <div>
              <label htmlFor="clientEmail" className="block text-sm font-medium text-gray-700 mb-2">
                Client Email
              </label>
              <input
                type="email"
                id="clientEmail"
                name="clientEmail"
                required
                className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="john@example.com"
              />
            </div>

            <div>
              <label htmlFor="storageFolderUrl" className="block text-sm font-medium text-gray-700 mb-2">
                Storage Folder URL
              </label>
              <input
                type="url"
                id="storageFolderUrl"
                name="storageFolderUrl"
                required
                value={storageFolderUrl}
                onChange={(e) => setStorageFolderUrl(e.target.value)}
                className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="https://www.dropbox.com/scl/fo/... or Google Drive/SharePoint URL"
              />
              <div className="mt-2 space-y-1">
                {detectedProvider ? (
                  <p className="text-sm text-green-600 flex items-center gap-1">
                    <span>✓</span>
                    <span>Detected: <strong>{PROVIDER_LABELS[detectedProvider]}</strong></span>
                  </p>
                ) : storageFolderUrl.length > 0 ? (
                  <p className="text-sm text-amber-600">
                    Unable to detect provider. Please use a valid URL from a supported service.
                  </p>
                ) : null}
                <p className="text-sm text-gray-500">
                  Supported: Dropbox, Google Drive, SharePoint/OneDrive
                </p>
              </div>
            </div>

            {error && (
              <div className="p-4 bg-red-50 text-red-700 rounded-lg">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-3 px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSubmitting ? 'Creating...' : 'Create Engagement'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
