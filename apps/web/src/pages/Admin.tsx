import { useState, useEffect } from 'react'

const rawApiUrl = import.meta.env.VITE_API_URL || ''
const API_URL = rawApiUrl && !rawApiUrl.startsWith('http') ? `https://${rawApiUrl}` : rawApiUrl

interface TestEngagement {
  id: string
  clientName: string
  clientEmail: string
  status: string
  createdAt: string
  reasons: string[]
}

interface TestDataResponse {
  total: number
  testCount: number
  realCount: number
  testEngagements: TestEngagement[]
  realEngagements: Array<{
    id: string
    clientName: string
    clientEmail: string
    status: string
    createdAt: string
  }>
}

export default function Admin() {
  const [adminSecret, setAdminSecret] = useState(() => localStorage.getItem('adminSecret') || '')
  const [data, setData] = useState<TestDataResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    localStorage.setItem('adminSecret', adminSecret)
  }, [adminSecret])

  const fetchData = async () => {
    if (!adminSecret) {
      setError('Enter admin secret first')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_URL}/api/admin/test-data`, {
        headers: { Authorization: `Bearer ${adminSecret}` },
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      setData(await res.json())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch')
    } finally {
      setLoading(false)
    }
  }

  const deleteTestData = async () => {
    if (!confirm('Delete all test engagements?')) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_URL}/api/admin/test-data`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminSecret}` },
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      const result = await res.json()
      setMessage(`Deleted ${result.deletedCount} test engagements`)
      fetchData()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete')
    } finally {
      setLoading(false)
    }
  }

  const deleteEngagement = async (id: string) => {
    if (!confirm('Delete this engagement?')) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_URL}/api/admin/engagements/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminSecret}` },
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      setMessage('Engagement deleted')
      fetchData()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete')
    } finally {
      setLoading(false)
    }
  }

  const deleteAllEngagements = async () => {
    if (!confirm('⚠️ DELETE ALL ENGAGEMENTS? This cannot be undone!')) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_URL}/api/engagements`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      const result = await res.json()
      setMessage(`Deleted all ${result.count} engagements`)
      setData(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ padding: '2rem', maxWidth: '1000px', margin: '0 auto', fontFamily: 'system-ui' }}>
      <h1 style={{ marginBottom: '1.5rem' }}>🔧 Admin</h1>

      {/* Quick Actions - No Auth Required */}
      <div style={{ padding: '1.5rem', background: '#fef2f2', borderRadius: '8px', marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem', color: '#991b1b' }}>⚡ Quick Actions</h2>
        <button
          onClick={deleteAllEngagements}
          disabled={loading}
          style={{
            padding: '1rem 2rem',
            background: '#dc2626',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            cursor: loading ? 'wait' : 'pointer',
            fontSize: '1.1rem',
            fontWeight: 'bold',
          }}
        >
          🗑️ Clear All Engagements
        </button>
      </div>

      <hr style={{ margin: '2rem 0', border: 'none', borderTop: '1px solid #e5e7eb' }} />

      {/* Detailed View - Requires Auth */}
      <div style={{ marginBottom: '1.5rem' }}>
        <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>
          Admin Secret (for detailed view)
        </label>
        <input
          type="password"
          value={adminSecret}
          onChange={(e) => setAdminSecret(e.target.value)}
          placeholder="Enter ADMIN_SECRET"
          style={{
            padding: '0.5rem',
            width: '300px',
            border: '1px solid #ccc',
            borderRadius: '4px',
            marginRight: '0.5rem',
          }}
        />
        <button
          onClick={fetchData}
          disabled={loading}
          style={{
            padding: '0.5rem 1rem',
            background: '#2563eb',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: loading ? 'wait' : 'pointer',
          }}
        >
          {loading ? 'Loading...' : 'Load Data'}
        </button>
      </div>

      {error && (
        <div style={{ padding: '1rem', background: '#fef2f2', color: '#dc2626', borderRadius: '4px', marginBottom: '1rem' }}>
          {error}
        </div>
      )}

      {message && (
        <div style={{ padding: '1rem', background: '#f0fdf4', color: '#16a34a', borderRadius: '4px', marginBottom: '1rem' }}>
          {message}
        </div>
      )}

      {data && (
        <>
          <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem' }}>
            <div style={{ padding: '1rem', background: '#f3f4f6', borderRadius: '8px', flex: 1 }}>
              <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>{data.total}</div>
              <div style={{ color: '#6b7280' }}>Total</div>
            </div>
            <div style={{ padding: '1rem', background: '#fef3c7', borderRadius: '8px', flex: 1 }}>
              <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>{data.testCount}</div>
              <div style={{ color: '#92400e' }}>Test Data</div>
            </div>
            <div style={{ padding: '1rem', background: '#d1fae5', borderRadius: '8px', flex: 1 }}>
              <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>{data.realCount}</div>
              <div style={{ color: '#065f46' }}>Real</div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
            {data.testCount > 0 && (
              <button
                onClick={deleteTestData}
                disabled={loading}
                style={{
                  padding: '0.5rem 1rem',
                  background: '#f59e0b',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                🧹 Clear Test Data ({data.testCount})
              </button>
            )}
            <button
              onClick={deleteAllEngagements}
              disabled={loading}
              style={{
                padding: '0.5rem 1rem',
                background: '#dc2626',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              ☢️ Delete ALL Engagements
            </button>
          </div>

          {data.testEngagements.length > 0 && (
            <div style={{ marginBottom: '2rem' }}>
              <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>Test Engagements</h2>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f9fafb', textAlign: 'left' }}>
                    <th style={{ padding: '0.75rem', borderBottom: '1px solid #e5e7eb' }}>Client</th>
                    <th style={{ padding: '0.75rem', borderBottom: '1px solid #e5e7eb' }}>Email</th>
                    <th style={{ padding: '0.75rem', borderBottom: '1px solid #e5e7eb' }}>Reason</th>
                    <th style={{ padding: '0.75rem', borderBottom: '1px solid #e5e7eb' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {data.testEngagements.map((e) => (
                    <tr key={e.id}>
                      <td style={{ padding: '0.75rem', borderBottom: '1px solid #e5e7eb' }}>{e.clientName}</td>
                      <td style={{ padding: '0.75rem', borderBottom: '1px solid #e5e7eb' }}>{e.clientEmail}</td>
                      <td style={{ padding: '0.75rem', borderBottom: '1px solid #e5e7eb', fontSize: '0.875rem', color: '#6b7280' }}>
                        {e.reasons.join(', ')}
                      </td>
                      <td style={{ padding: '0.75rem', borderBottom: '1px solid #e5e7eb' }}>
                        <button
                          onClick={() => deleteEngagement(e.id)}
                          style={{ color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer' }}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {data.realEngagements.length > 0 && (
            <div>
              <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>Real Engagements</h2>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f9fafb', textAlign: 'left' }}>
                    <th style={{ padding: '0.75rem', borderBottom: '1px solid #e5e7eb' }}>Client</th>
                    <th style={{ padding: '0.75rem', borderBottom: '1px solid #e5e7eb' }}>Email</th>
                    <th style={{ padding: '0.75rem', borderBottom: '1px solid #e5e7eb' }}>Status</th>
                    <th style={{ padding: '0.75rem', borderBottom: '1px solid #e5e7eb' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {data.realEngagements.map((e) => (
                    <tr key={e.id}>
                      <td style={{ padding: '0.75rem', borderBottom: '1px solid #e5e7eb' }}>{e.clientName}</td>
                      <td style={{ padding: '0.75rem', borderBottom: '1px solid #e5e7eb' }}>{e.clientEmail}</td>
                      <td style={{ padding: '0.75rem', borderBottom: '1px solid #e5e7eb' }}>{e.status}</td>
                      <td style={{ padding: '0.75rem', borderBottom: '1px solid #e5e7eb' }}>
                        <button
                          onClick={() => deleteEngagement(e.id)}
                          style={{ color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer' }}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
