import { useEffect, useState, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { getEngagements, deleteAllEngagements, type Engagement } from '../api/client'

const statusConfig: Record<string, { label: string; dotColor: string; textColor: string; icon?: 'check' }> = {
  PENDING: { label: 'Pending', dotColor: 'bg-amber-400', textColor: 'text-amber-600' },
  INTAKE_DONE: { label: 'Intake Done', dotColor: 'bg-blue-500', textColor: 'text-blue-600' },
  COLLECTING: { label: 'Collecting', dotColor: 'bg-orange-500', textColor: 'text-orange-600' },
  READY: { label: 'Ready', dotColor: 'bg-green-500', textColor: 'text-green-600', icon: 'check' },
}

function StatusBadge({ status }: { status: string }) {
  const config = statusConfig[status] || statusConfig.PENDING
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm ${config.textColor}`}>
      {config.icon === 'check' ? (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
        </svg>
      ) : (
        <span className={`w-2 h-2 rounded-full ${config.dotColor}`} />
      )}
      {config.label}
    </span>
  )
}

function ProgressBar({ value }: { value: number }) {
  const fillColor = value === 0 ? 'bg-gray-400' : value === 100 ? 'bg-blue-800' : 'bg-blue-600'
  return (
    <div className="flex items-center gap-2">
      <span className="w-8 text-sm text-gray-700">{value}%</span>
      <div className="w-20 h-2 rounded-full bg-gray-200">
        <div className={`h-2 rounded-full ${fillColor}`} style={{ width: `${value}%` }} />
      </div>
    </div>
  )
}

export default function Dashboard() {
  const [engagements, setEngagements] = useState<Engagement[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [clearing, setClearing] = useState(false)
  const navigate = useNavigate()
  
  // Triple-click detection for hidden reset
  const clickCount = useRef(0)
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleTitleClick = () => {
    clickCount.current += 1
    
    if (clickTimer.current) {
      clearTimeout(clickTimer.current)
    }
    
    if (clickCount.current === 3) {
      // Triple-click detected - show confirmation
      clickCount.current = 0
      handleClearDemo()
    } else {
      // Reset after 500ms
      clickTimer.current = setTimeout(() => {
        clickCount.current = 0
      }, 500)
    }
  }

  const handleClearDemo = async () => {
    if (!confirm('⚠️ Clear all demo data? This will delete ALL engagements and cannot be undone.')) {
      return
    }
    
    setClearing(true)
    try {
      const result = await deleteAllEngagements()
      setEngagements([])
      alert(`✅ Cleared ${result.count} engagements`)
    } catch (err) {
      alert(`❌ Failed to clear: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setClearing(false)
    }
  }

  useEffect(() => {
    getEngagements()
      .then(setEngagements)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  const filtered = engagements.filter(eng =>
    eng.clientName.toLowerCase().includes(search.toLowerCase())
  )

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-gray-500">Loading...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-red-600">Error: {error}</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white max-w-screen-xl mx-auto px-6 pt-[60px]">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 
          className="text-2xl font-semibold text-gray-900 select-none cursor-default"
          onClick={handleTitleClick}
        >
          {clearing ? 'Clearing...' : 'Tax Intake Agent'}
        </h1>
        <Link
          to="/engagements/new"
          className="inline-flex items-center gap-1.5 h-9 px-4 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          New Engagement
        </Link>
      </div>

      {/* Search */}
      <div className="flex items-center h-9 border border-gray-300 rounded-lg mb-6 overflow-hidden">
        <div className="flex items-center flex-1 px-3 gap-2">
          <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input
            type="text"
            placeholder="Search by client name"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full text-sm outline-none placeholder:text-gray-400"
          />
        </div>
        <div className="border-l border-gray-300 h-full flex items-center px-3">
          <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 01-.659 1.591l-5.432 5.432a2.25 2.25 0 00-.659 1.591v2.927a2.25 2.25 0 01-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 00-.659-1.591L3.659 7.409A2.25 2.25 0 013 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0112 3z" />
          </svg>
        </div>
      </div>

      {/* Table */}
      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-2.5" style={{ width: 200 }}>Name</th>
              <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-2.5" style={{ width: 320 }}>Email</th>
              <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-2.5" style={{ width: 200 }}>Status</th>
              <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-2.5" style={{ width: 200 }}>Progress</th>
              <th className="text-left text-xs font-medium text-gray-500 uppercase px-4 py-2.5" style={{ width: 272 }}>Tax Year</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center py-12 text-gray-500">
                  {engagements.length === 0 ? (
                    <div>
                      <p className="mb-2">No engagements yet</p>
                      <Link to="/engagements/new" className="text-blue-600 hover:underline text-sm">
                        Create your first engagement
                      </Link>
                    </div>
                  ) : (
                    'No results found'
                  )}
                </td>
              </tr>
            ) : (
              filtered.map((engagement) => {
                const completion = engagement.reconciliation?.completionPercentage ?? 0

                return (
                  <tr
                    key={engagement.id}
                    onClick={() => navigate(`/engagements/${engagement.id}`)}
                    onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/engagements/${engagement.id}`) }}
                    tabIndex={0}
                    role="link"
                    className="h-[42px] border-b border-gray-200 hover:bg-gray-50 cursor-pointer focus:outline-none focus:bg-blue-50"
                  >
                    <td className="px-4 text-sm font-medium text-gray-900">{engagement.clientName}</td>
                    <td className="px-4 text-sm text-gray-600">{engagement.clientEmail}</td>
                    <td className="px-4">
                      <StatusBadge status={engagement.status} />
                    </td>
                    <td className="px-4">
                      <ProgressBar value={completion} />
                    </td>
                    <td className="px-4 text-sm text-gray-700">{engagement.taxYear}</td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
