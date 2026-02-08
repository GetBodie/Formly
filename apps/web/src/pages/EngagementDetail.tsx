import { useEffect, useState } from 'react'
import { useParams, useSearchParams, Link } from 'react-router-dom'
import Markdown from 'react-markdown'
import {
  getEngagement,
  generateBrief,
  approveDocument,
  reclassifyDocument,
  sendDocumentFollowUp,
  retryDocument,
  archiveDocument,
  unarchiveDocument,
  getEmailPreview,
  DOCUMENT_TYPES,
  type Engagement,
  type Document,
  type Reconciliation,
  type FriendlyIssue,
} from '../api/client'
import { parseIssue, getSuggestedAction, hasErrors, hasWarnings } from '../utils/issues'

const statusColors: Record<string, string> = {
  PENDING: 'bg-gray-100 text-gray-800',
  INTAKE_DONE: 'bg-blue-100 text-blue-800',
  COLLECTING: 'bg-yellow-100 text-yellow-800',
  READY: 'bg-green-100 text-green-800',
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-'
  const d = new Date(dateStr)
  const month = d.getMonth() + 1
  const day = d.getDate()
  const year = d.getFullYear()
  const hours = d.getHours()
  const minutes = d.getMinutes().toString().padStart(2, '0')
  const ampm = hours >= 12 ? 'pm' : 'am'
  const h = hours % 12 || 12
  return `${month}/${day}/${year}, ${h}:${minutes}${ampm}`
}

function getDocStatus(doc: Document): 'error' | 'warning' | 'ok' {
  if (doc.processingStatus === 'error') return 'error'
  if (doc.approved) return 'ok'
  if (hasErrors(doc.issues)) return 'error'
  if (hasWarnings(doc.issues)) return 'warning'
  if (doc.issues.length === 0 && doc.documentType !== 'PENDING') return 'ok'
  return 'ok'
}

function storageIcon(provider: string) {
  switch (provider?.toLowerCase()) {
    case 'sharepoint':
      return (
        <svg className="w-4 h-4 inline-block" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 2v20M2 12h20" />
        </svg>
      )
    case 'googledrive':
      return (
        <svg className="w-4 h-4 inline-block" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 2L2 19h8l10-17H12z" />
        </svg>
      )
    case 'dropbox':
      return (
        <svg className="w-4 h-4 inline-block" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 2l-7 4.5 7 4.5 7-4.5L12 2zM5 11l7 4.5 7-4.5M5 15.5L12 20l7-4.5" />
        </svg>
      )
    default:
      return (
        <svg className="w-4 h-4 inline-block" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
        </svg>
      )
  }
}

export default function EngagementDetail() {
  const { id } = useParams<{ id: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const [engagement, setEngagement] = useState<Engagement | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [generatingBrief, setGeneratingBrief] = useState(false)
  const [actionInProgress, setActionInProgress] = useState<string | null>(null)
  const [showArchived] = useState(false)
  const [showPrepBrief, setShowPrepBrief] = useState(false)
  const [selectedDocId, setSelectedDocId] = useState<string | null>(searchParams.get('doc'))
  const [expandedIssueIdx, setExpandedIssueIdx] = useState<number>(0)

  // Email modal state
  const [showEmailModal, setShowEmailModal] = useState(false)
  const [loadingEmail, setLoadingEmail] = useState(false)
  const [emailInput, setEmailInput] = useState('')
  const [subjectInput, setSubjectInput] = useState('')
  const [bodyInput, setBodyInput] = useState('')
  const [emailDocId, setEmailDocId] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return

    getEngagement(id)
      .then(setEngagement)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [id])

  // Auto-poll while engagement is actively processing
  useEffect(() => {
    if (!id || !engagement) return
    if (!['INTAKE_DONE', 'COLLECTING'].includes(engagement.status)) return

    const interval = setInterval(() => {
      getEngagement(id).then(setEngagement).catch(() => {})
    }, 3000)

    return () => clearInterval(interval)
  }, [id, engagement?.status])

  // Sync selectedDocId to URL
  useEffect(() => {
    if (selectedDocId) {
      setSearchParams({ doc: selectedDocId })
    } else {
      setSearchParams({})
    }
  }, [selectedDocId, setSearchParams])

  async function handleGenerateBrief() {
    if (!id || !engagement) return

    setGeneratingBrief(true)
    try {
      const result = await generateBrief(id)
      setEngagement({ ...engagement, prepBrief: result.brief })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate brief')
    } finally {
      setGeneratingBrief(false)
    }
  }

  async function handleApproveDocument(docId: string) {
    if (!id || !engagement) return

    setActionInProgress('approve')
    try {
      const result = await approveDocument(id, docId)
      const documents = (engagement.documents || []).map(d =>
        d.id === docId ? result.document : d
      )
      setEngagement({ ...engagement, documents })
      // Refetch after reconciliation runs (async on server) to pick up status changes
      setTimeout(async () => {
        try {
          const updated = await getEngagement(id)
          setEngagement(updated)
        } catch { /* ignore */ }
      }, 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve document')
    } finally {
      setActionInProgress(null)
    }
  }

  async function handleReclassifyDocument(docId: string, newType: string) {
    if (!id || !engagement || !newType) return

    setActionInProgress('reclassify')
    try {
      const result = await reclassifyDocument(id, docId, newType)
      const documents = (engagement.documents || []).map(d =>
        d.id === docId ? result.document : d
      )
      setEngagement({ ...engagement, documents })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reclassify document')
    } finally {
      setActionInProgress(null)
    }
  }

  async function handleSendFollowUp(docId: string, options: { email: string; subject: string; body: string }) {
    if (!id || !engagement) return

    setActionInProgress('email')
    try {
      const result = await sendDocumentFollowUp(id, docId, options)
      setError(null)
      alert(result.message || 'Follow-up email sent successfully')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send email')
    } finally {
      setActionInProgress(null)
    }
  }


  async function handleRetryDocument(docId: string) {
    if (!id || !engagement) return

    setActionInProgress('retry')
    try {
      const result = await retryDocument(id, docId)
      const documents = (engagement.documents || []).map(d =>
        d.id === docId ? result.document : d
      )
      setEngagement({ ...engagement, documents })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to retry document')
    } finally {
      setActionInProgress(null)
    }
  }

  async function handleArchiveDocument(docId: string, reason?: string) {
    if (!id || !engagement) return

    setActionInProgress('archive')
    try {
      const result = await archiveDocument(id, docId, reason)
      const documents = (engagement.documents || []).map(d =>
        d.id === docId ? result.document : d
      )
      setEngagement({ ...engagement, documents })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to archive document')
    } finally {
      setActionInProgress(null)
    }
  }

  async function handleUnarchiveDocument(docId: string) {
    if (!id || !engagement) return

    setActionInProgress('unarchive')
    try {
      const result = await unarchiveDocument(id, docId)
      const documents = (engagement.documents || []).map(d =>
        d.id === docId ? result.document : d
      )
      setEngagement({ ...engagement, documents })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to restore document')
    } finally {
      setActionInProgress(null)
    }
  }

  async function openEmailModal(docId: string) {
    if (!id) return
    setEmailDocId(docId)
    setLoadingEmail(true)
    setShowEmailModal(true)
    try {
      const preview = await getEmailPreview(id, docId)
      setEmailInput(preview.recipientEmail)
      setSubjectInput(preview.subject)
      setBodyInput(preview.body)
    } catch {
      setEmailInput(engagement?.clientEmail || '')
      setSubjectInput(`Action Needed: Document`)
      setBodyInput(`Hi,\n\nPlease upload a corrected version of the document.\n\nThank you.`)
    } finally {
      setLoadingEmail(false)
    }
  }

  function openPrepBrief() {
    setShowPrepBrief(true)
    if (!engagement?.prepBrief && !generatingBrief) {
      handleGenerateBrief()
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-gray-500">Loading...</div>
      </div>
    )
  }

  if (error && !engagement) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-red-600">Error: {error || 'Engagement not found'}</div>
      </div>
    )
  }

  if (!engagement) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-red-600">Engagement not found</div>
      </div>
    )
  }

  const allDocuments = (engagement.documents as Document[]) || []
  const visibleDocuments = showArchived ? allDocuments : allDocuments.filter(d => !d.archived)
  const reconciliation = engagement.reconciliation as Reconciliation | null

  const completionPct = reconciliation?.completionPercentage ?? 0
  const errorDocs = visibleDocuments.filter(d => getDocStatus(d) === 'error')
  const warningDocs = visibleDocuments.filter(d => getDocStatus(d) === 'warning')
  const timeSaved = Math.round(visibleDocuments.length * 0.75)
  const selectedDoc = selectedDocId ? allDocuments.find(d => d.id === selectedDocId) : null

  return (
    <div className="min-h-screen bg-white">
      <div className="px-[160px] pt-[60px]">
        {/* Error banner */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-800 text-sm flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="text-red-600 hover:text-red-800 ml-4" aria-label="Dismiss error">
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
            </button>
          </div>
        )}

        {/* Back button */}
        <Link to="/" className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900">
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
          Back to Dashboard
        </Link>

        {/* Header Section */}
        <div className="flex items-center justify-between mt-3 mb-3">
          <h1 className="text-2xl font-semibold text-gray-900 tracking-tight">{engagement.clientName}</h1>
          <div className="flex items-center gap-2">
            {engagement.status === 'READY' && (
              <button
                onClick={openPrepBrief}
                className="inline-flex items-center gap-1.5 h-8 px-3 bg-[#042f84] text-white text-sm font-medium rounded-lg hover:bg-[#03246a] transition-colors"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                View Prep Brief
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-[60px] mb-6">
          <div className="flex flex-col gap-2">
            <div className="text-sm text-gray-500">Email</div>
            <div className="text-base font-medium">{engagement.clientEmail}</div>
          </div>
          <div className="flex flex-col gap-2">
            <div className="text-sm text-gray-500">Tax Year</div>
            <div className="text-base font-medium">{engagement.taxYear}</div>
          </div>
          <div className="flex flex-col gap-2">
            <div className="text-sm text-gray-500">Status</div>
            <span className={`inline-block px-2 py-0.5 rounded-lg text-xs font-medium ${statusColors[engagement.status]}`}>
              {engagement.status.replace(/_/g, ' ')}
            </span>
          </div>
          <div className="flex flex-col gap-2">
            <div className="text-sm text-gray-500">Storage</div>
            <a
              href={engagement.storageFolderUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium inline-flex items-center gap-2 text-blue-500 hover:text-blue-600"
            >
              {storageIcon(engagement.storageProvider)}
              {engagement.storageProvider}
            </a>
          </div>
        </div>

        {/* 3 Stat Tiles */}
        <div className="flex gap-4 mb-6">
          {/* Documents Received */}
          <div className="flex-1 border border-[#e0e3e8] rounded-lg p-3 bg-white h-[96px] flex flex-col gap-2">
            <div className="text-sm text-gray-500">Documents Received</div>
            <div className="flex items-center gap-2 flex-1">
              <span className="text-2xl font-semibold tracking-tight">{completionPct}%</span>
              <div className="flex-1">
                <div className="h-2 rounded-full bg-gray-200 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${completionPct >= 100 ? 'bg-green-600' : 'bg-blue-600'}`}
                    style={{ width: `${Math.min(completionPct, 100)}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Docs Requiring Attention */}
          <div className="flex-1 border border-[#e0e3e8] rounded-lg p-3 bg-white h-[96px] flex flex-col gap-2">
            <div className="text-sm text-gray-500">Docs Requiring Attention</div>
            <div className="flex flex-col gap-1 justify-center flex-1">
              <div className="flex items-center gap-1 text-sm">
                <span className="w-3 h-3 rounded-sm bg-red-600 inline-block flex-shrink-0" />
                <span>{errorDocs.length} Needs Action</span>
              </div>
              <div className="flex items-center gap-1 text-sm">
                <span className="w-3 h-3 rounded-sm bg-yellow-400 inline-block flex-shrink-0" />
                <span>{warningDocs.length} Needs Review</span>
              </div>
            </div>
          </div>

          {/* Time Saved */}
          <div className="flex-1 border border-[#e0e3e8] rounded-lg p-3 bg-white h-[96px] flex flex-col gap-2">
            <div className="text-sm text-gray-500">Time Saved</div>
            <div className="text-2xl font-semibold tracking-tight flex-1 flex items-center">{timeSaved}hrs</div>
          </div>
        </div>

        {/* Split Panel */}
        <div className="flex gap-[3px]">
          {/* Left: Document Table */}
          <div className="flex-1 border border-[#e5e5e5] rounded-lg overflow-hidden">
            {/* Table Header */}
            <div className="grid grid-cols-[200px_200px_1fr] text-sm font-medium text-gray-900 px-2 py-2 bg-gray-50">
              <div>Document</div>
              <div>Status</div>
              <div>Uploaded at</div>
            </div>

            {/* Table Rows */}
            <div className="overflow-y-auto max-h-[500px]">
              {visibleDocuments.length === 0 ? (
                <div className="p-8 text-center text-gray-500 text-sm">
                  No documents yet.
                </div>
              ) : (
                visibleDocuments.map(doc => {
                  const status = getDocStatus(doc)
                  const isSelected = doc.id === selectedDocId
                  return (
                    <button
                      key={doc.id}
                      onClick={() => {
                        setSelectedDocId(doc.id)
                        setExpandedIssueIdx(0)
                      }}
                      className={`w-full grid grid-cols-[200px_200px_1fr] items-center px-2 h-[42px] text-sm border-b border-[#e5e5e5] transition-colors text-left ${
                        isSelected ? 'bg-black/5' : 'hover:bg-gray-50'
                      } ${doc.archived ? 'opacity-50' : ''}`}
                    >
                      <div className={`truncate ${doc.archived ? 'line-through text-gray-400' : 'text-gray-900'}`}>
                        {doc.documentType}
                      </div>
                      <div>
                        {status === 'error' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-medium bg-red-100 text-red-600 border border-[#e5e5e5]">
                            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                            Needs Action
                          </span>
                        ) : status === 'warning' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-medium bg-yellow-100 text-yellow-700 border border-[#e5e5e5]">
                            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
                            Needs Review
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-medium bg-green-100 text-green-900 border border-[#e5e5e5]">
                            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6L9 17l-5-5" /></svg>
                            OK
                          </span>
                        )}
                      </div>
                      <div className="text-gray-900 text-sm">{formatDate(doc.classifiedAt)}</div>
                    </button>
                  )
                })
              )}
            </div>
          </div>

          {/* Chevron Separator */}
          <div className="flex-shrink-0 flex items-start justify-center pt-[44px]">
            <svg className="w-6 h-6 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </div>

          {/* Right: Document Detail Panel */}
          <div className="w-[457px] flex-shrink-0 bg-white border border-[#e5e5e5] rounded-lg shadow-sm overflow-hidden">
            {selectedDoc ? (
              <DocumentPanel
                key={selectedDoc.id}
                doc={selectedDoc}
                expandedIssueIdx={expandedIssueIdx}
                setExpandedIssueIdx={setExpandedIssueIdx}
                onClose={() => setSelectedDocId(null)}
                onApprove={handleApproveDocument}
                onReclassify={handleReclassifyDocument}
                onRetry={handleRetryDocument}
                onArchive={handleArchiveDocument}
                onUnarchive={handleUnarchiveDocument}
                onOpenEmail={openEmailModal}
                actionInProgress={actionInProgress}
              />
            ) : (
              <div className="h-full flex flex-col items-center justify-center p-8 text-gray-400 min-h-[400px]">
                <svg className="w-12 h-12 mb-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M9 12h6M12 9v6M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-sm font-medium text-gray-500">Select a document</p>
                <p className="text-xs text-gray-400 mt-1">Click a row to view details</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Prep Brief Side Sheet */}
      {showPrepBrief && (
        <>
          <div
            className="fixed inset-0 bg-black/30 z-50"
            onClick={() => setShowPrepBrief(false)}
          />
          <div className="fixed right-0 top-0 w-[720px] h-full bg-white z-50 shadow-xl transform transition-transform flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h2 className="text-lg font-semibold">Prep Brief</h2>
              <button
                onClick={() => setShowPrepBrief(false)}
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100"
                aria-label="Close prep brief"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {generatingBrief ? (
                <div className="flex flex-col items-center justify-center py-20 text-gray-500">
                  <div className="animate-spin w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full mb-3" />
                  <p>Generating prep brief...</p>
                </div>
              ) : engagement.prepBrief ? (
                <div className="prep-brief">
                  <Markdown>{engagement.prepBrief}</Markdown>
                </div>
              ) : (
                <div className="text-center py-20 text-gray-500">
                  <p>Brief will be available when all documents are collected.</p>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Email Modal */}
      {showEmailModal && emailDocId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold mb-4">Send Follow-up Email</h3>
            {loadingEmail ? (
              <div className="py-8 text-center text-gray-500">
                <div className="animate-spin inline-block w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full mb-2" />
                <p>Generating email...</p>
              </div>
            ) : (
              <>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">To</label>
                  <input
                    type="email"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg"
                  />
                </div>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
                  <input
                    type="text"
                    value={subjectInput}
                    onChange={(e) => setSubjectInput(e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg"
                  />
                </div>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Message</label>
                  <textarea
                    value={bodyInput}
                    onChange={(e) => setBodyInput(e.target.value)}
                    rows={6}
                    className="w-full px-3 py-2 border rounded-lg font-mono text-sm"
                  />
                </div>
                <div className="flex gap-3 justify-end">
                  <button
                    onClick={() => {
                      setShowEmailModal(false)
                      setEmailDocId(null)
                    }}
                    className="px-4 py-2 text-gray-600 hover:text-gray-800"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      handleSendFollowUp(emailDocId, { email: emailInput, subject: subjectInput, body: bodyInput })
                      setShowEmailModal(false)
                      setEmailDocId(null)
                    }}
                    disabled={!emailInput || !subjectInput || !bodyInput}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    Send Email
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// Document Detail Panel (right side)
interface DocumentPanelProps {
  doc: Document
  expandedIssueIdx: number
  setExpandedIssueIdx: (idx: number) => void
  onClose: () => void
  onApprove: (docId: string) => Promise<void>
  onReclassify: (docId: string, newType: string) => Promise<void>
  onRetry: (docId: string) => Promise<void>
  onArchive: (docId: string, reason?: string) => Promise<void>
  onUnarchive: (docId: string) => Promise<void>
  onOpenEmail: (docId: string) => void
  actionInProgress: string | null
}

function DocumentPanel({
  doc,
  expandedIssueIdx,
  setExpandedIssueIdx,
  onClose,
  onApprove,
  onReclassify,
  onRetry,
  onArchive,
  onUnarchive,
  onOpenEmail,
  actionInProgress,
}: DocumentPanelProps) {
  const [selectedType, setSelectedType] = useState('')
  const hasUnresolvedIssues = doc.issues.length > 0 && doc.approved !== true

  const friendlyIssues: FriendlyIssue[] = doc.issueDetails || doc.issues.map(issue => {
    const parsed = parseIssue(issue)
    return {
      original: issue,
      friendlyMessage: parsed.description,
      suggestedAction: getSuggestedAction(parsed),
      severity: parsed.severity,
    }
  })

  return (
    <div className="flex flex-col h-full py-4">
      {/* Header */}
      <div className="flex items-center justify-between px-4">
        <h2 className="text-base font-semibold text-gray-900">Document Detail</h2>
        <button
          onClick={onClose}
          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100"
          aria-label="Close document detail"
        >
          <svg className="w-4 h-4 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {/* Archived banner */}
        {doc.archived && (
          <div className="mx-4 mt-3 p-3 bg-gray-100 border border-gray-300 rounded-lg">
            <div className="text-sm font-medium text-gray-700">Document Archived</div>
            {doc.archivedReason && (
              <p className="mt-1 text-xs text-gray-600">{doc.archivedReason}</p>
            )}
            <button
              onClick={() => onUnarchive(doc.id)}
              disabled={actionInProgress !== null}
              className="mt-2 w-full py-1.5 px-3 text-xs bg-gray-600 text-white rounded hover:bg-gray-700 disabled:opacity-50"
            >
              {actionInProgress === 'unarchive' ? 'Restoring...' : 'Restore Document'}
            </button>
          </div>
        )}

        {/* Error state */}
        {!doc.archived && doc.processingStatus === 'error' && (
          <div className="mx-4 mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
            <div className="text-sm font-medium text-red-800">Processing Failed</div>
            <button
              onClick={() => onRetry(doc.id)}
              disabled={actionInProgress !== null}
              className="mt-2 w-full py-1.5 px-3 text-xs bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
            >
              {actionInProgress === 'retry' ? 'Retrying...' : 'Retry Processing'}
            </button>
          </div>
        )}

        {/* Info section */}
        <div className="px-4 mt-2 flex flex-col gap-3">
          {/* Row 1: 3 items */}
          <div className="flex items-start justify-between">
            <div className="flex flex-col gap-1">
              <div className="text-sm text-gray-500">Uploaded file</div>
              <div className="text-sm text-black truncate">{doc.fileName}</div>
            </div>
            <div className="flex flex-col gap-1">
              <div className="text-sm text-gray-500">System Detected</div>
              <div className="text-sm text-black">{doc.documentType}</div>
            </div>
            <div className="flex flex-col gap-1">
              <div className="text-sm text-gray-500">Confidence</div>
              <div className="text-sm text-black">{Math.round(doc.confidence * 100)}%</div>
            </div>
          </div>
          {/* Row 2: 2 items */}
          <div className="flex items-start gap-[49px]">
            <div className="flex flex-col gap-1 w-[145px]">
              <div className="text-sm text-gray-500">Tax Year</div>
              <div className="text-sm text-black">{doc.taxYear || 'Unknown'}</div>
            </div>
            <div className="flex flex-col gap-1 flex-1">
              <div className="text-sm text-gray-500">Status</div>
              <div className="text-sm text-gray-700">
                {doc.approved ? 'Approved' : 'Pending Review'}
              </div>
            </div>
            {doc.override && (
              <div className="flex flex-col gap-1">
                <div className="text-sm text-gray-500">Reclassified</div>
                <div className="text-sm text-black">from {doc.override.originalType}</div>
              </div>
            )}
          </div>
        </div>

        {/* Reclassify */}
        {!doc.archived && !doc.approved && (
          <div className="px-4 mt-3">
            <div className="flex gap-2">
              <select
                value={selectedType}
                onChange={(e) => setSelectedType(e.target.value)}
                className="flex-1 py-1.5 px-3 border rounded-lg text-sm"
              >
                <option value="">Change type to...</option>
                {DOCUMENT_TYPES.filter(t => t !== doc.documentType && t !== 'PENDING').map(type => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
              <button
                onClick={() => {
                  if (selectedType) {
                    onReclassify(doc.id, selectedType)
                    setSelectedType('')
                  }
                }}
                disabled={!selectedType || actionInProgress !== null}
                className="py-1.5 px-3 border rounded-lg hover:bg-gray-50 disabled:opacity-50 text-sm"
              >
                Apply
              </button>
            </div>
          </div>
        )}

        {/* Issues section */}
        {friendlyIssues.length > 0 && (
          <div className="mt-8">
            <div className="flex items-center justify-between px-4 mb-2">
              <h3 className="text-base font-semibold text-gray-900">Issues</h3>
              {friendlyIssues.length > 2 && (
                <button className="text-sm font-medium text-blue-500 hover:text-blue-600">See All</button>
              )}
            </div>

            <div>
              {friendlyIssues.map((issue, idx) => {
                const isExpanded = expandedIssueIdx === idx
                return (
                  <div key={idx}>
                    <div className="h-px bg-[#e5e5e5]" />
                    <button
                      onClick={() => setExpandedIssueIdx(isExpanded ? -1 : idx)}
                      className="w-full flex items-center gap-2 px-4 py-2 text-left"
                    >
                      <svg className="w-4 h-4 flex-shrink-0 text-red-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                      <span className="text-sm font-medium text-gray-900 flex-1">{issue.friendlyMessage}</span>
                      <svg
                        className={`w-6 h-6 text-gray-400 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M9 18l6-6-6-6" />
                      </svg>
                    </button>
                    {isExpanded && (
                      <div className="pl-[36px] pr-4 pb-4 flex flex-col gap-4">
                        <div className="flex flex-col gap-1">
                          <div className="text-sm text-gray-500">Issue Description</div>
                          <div className="text-sm text-black">{issue.friendlyMessage}</div>
                        </div>
                        <div className="flex flex-col gap-1">
                          <div className="text-sm text-gray-500">Recommended Action</div>
                          <div className="text-sm text-black">{issue.suggestedAction}</div>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
              <div className="h-px bg-[#e5e5e5]" />
            </div>
          </div>
        )}

        {/* Archive button */}
        {!doc.archived && (
          <div className="px-4 mt-3">
            <button
              onClick={() => onArchive(doc.id, 'Replaced by newer document')}
              disabled={actionInProgress !== null}
              className="w-full py-1.5 px-3 border border-gray-300 text-gray-500 text-xs rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              Archive Document
            </button>
          </div>
        )}
      </div>

      {/* Action buttons at bottom */}
      {hasUnresolvedIssues && !doc.archived && (
        <div className="px-4 py-3 flex gap-2 justify-end">
          <button
            onClick={() => onApprove(doc.id)}
            disabled={actionInProgress !== null}
            className="inline-flex items-center gap-1.5 h-8 px-3 bg-green-700 text-white text-sm font-medium rounded-lg hover:bg-green-800 disabled:opacity-50 transition-colors"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 6L9 17l-5-5" /></svg>
            {actionInProgress === 'approve' ? 'Approving...' : 'Approve Anyway'}
          </button>
          <button
            onClick={() => onOpenEmail(doc.id)}
            disabled={actionInProgress !== null}
            className="inline-flex items-center gap-1.5 h-8 px-3 bg-[#171717] text-white text-sm font-medium rounded-lg hover:bg-black disabled:opacity-50 transition-colors"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>
            Generate Email Follow-Up
          </button>
        </div>
      )}
    </div>
  )
}
