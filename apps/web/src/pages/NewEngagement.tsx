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

const PROVIDER_CONFIG: Record<StorageProvider, {
  placeholder: string
  helpText: string
  urlPattern: RegExp
}> = {
  'dropbox': {
    placeholder: 'https://www.dropbox.com/scl/fo/abc123...',
    helpText: 'Paste the shared folder link from Dropbox. Right-click folder → Share → Copy link.',
    urlPattern: /dropbox\.com/,
  },
  'google-drive': {
    placeholder: 'https://drive.google.com/drive/folders/abc123...',
    helpText: 'Paste the folder link from Google Drive. Right-click folder → Get link → Copy link.',
    urlPattern: /drive\.google\.com/,
  },
  'sharepoint': {
    placeholder: 'https://company.sharepoint.com/sites/...',
    helpText: 'Paste the SharePoint or OneDrive folder URL. Open the folder and copy the URL from your browser.',
    urlPattern: /(sharepoint\.com|onedrive\.com)/,
  },
}

export default function NewEngagement() {
  const navigate = useNavigate()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedProvider, setSelectedProvider] = useState<StorageProvider | null>(null)
  const [storageFolderUrl, setStorageFolderUrl] = useState('')

  const detectedProvider = useMemo(() => detectProvider(storageFolderUrl), [storageFolderUrl])
  
  // Validation: if provider is selected, URL must match that provider
  const urlMismatch = useMemo(() => {
    if (!selectedProvider || !storageFolderUrl || storageFolderUrl.length < 10) return false
    const detected = detectProvider(storageFolderUrl)
    return detected !== null && detected !== selectedProvider
  }, [selectedProvider, storageFolderUrl])

  const currentConfig = selectedProvider ? PROVIDER_CONFIG[selectedProvider] : null

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    
    // Validate URL matches selected provider
    if (urlMismatch) {
      setError(`URL doesn't match selected provider. Expected ${PROVIDER_LABELS[selectedProvider!]} URL.`)
      return
    }
    
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

  function handleProviderChange(provider: StorageProvider) {
    setSelectedProvider(provider)
    // Clear URL if it doesn't match the newly selected provider
    if (storageFolderUrl && detectProvider(storageFolderUrl) !== provider) {
      setStorageFolderUrl('')
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

            {/* Provider Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Storage Provider
              </label>
              <div className="grid grid-cols-3 gap-3">
                {(Object.keys(PROVIDER_CONFIG) as StorageProvider[]).map((provider) => (
                  <button
                    key={provider}
                    type="button"
                    onClick={() => handleProviderChange(provider)}
                    className={`p-3 border rounded-lg text-sm font-medium transition-colors ${
                      selectedProvider === provider
                        ? 'border-blue-500 bg-blue-50 text-blue-700'
                        : 'border-gray-300 hover:border-gray-400 text-gray-700'
                    }`}
                  >
                    {PROVIDER_LABELS[provider]}
                  </button>
                ))}
              </div>
              <p className="text-sm text-gray-500 mt-2">
                Select where your client will upload documents
              </p>
            </div>

            {/* Storage Folder URL */}
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
                className={`w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
                  urlMismatch ? 'border-red-300 bg-red-50' : ''
                }`}
                placeholder={currentConfig?.placeholder || 'Select a provider above, or paste any supported URL'}
              />
              <div className="mt-2 space-y-1">
                {/* Provider-specific help text */}
                {currentConfig && (
                  <p className="text-sm text-gray-600">
                    {currentConfig.helpText}
                  </p>
                )}
                
                {/* URL validation feedback */}
                {urlMismatch ? (
                  <p className="text-sm text-red-600 flex items-center gap-1">
                    <span>✗</span>
                    <span>URL is for {PROVIDER_LABELS[detectedProvider!]}, but you selected {PROVIDER_LABELS[selectedProvider!]}</span>
                  </p>
                ) : detectedProvider ? (
                  <p className="text-sm text-green-600 flex items-center gap-1">
                    <span>✓</span>
                    <span>Detected: <strong>{PROVIDER_LABELS[detectedProvider]}</strong></span>
                  </p>
                ) : storageFolderUrl.length > 0 ? (
                  <p className="text-sm text-amber-600">
                    Unable to detect provider. Please use a valid URL from a supported service.
                  </p>
                ) : null}
                
                {/* Always show supported providers if no provider selected */}
                {!selectedProvider && (
                  <p className="text-sm text-gray-500">
                    Supported: Dropbox, Google Drive, SharePoint/OneDrive
                  </p>
                )}
              </div>
            </div>

            {error && (
              <div className="p-4 bg-red-50 text-red-700 rounded-lg">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting || urlMismatch}
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
