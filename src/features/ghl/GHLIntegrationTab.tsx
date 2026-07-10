import { useState } from 'react'

// N8N webhook — live endpoint backed by GHL PIT for AM333 (hv6oU9BWN5BzCTe0dEMl)
const GHL_STATUS_URL = 'https://amwellinc.app.n8n.cloud/webhook/digitracker-ghl-status'

interface GHLContact {
  id: string
  name: string
  email: string
  phone: string
  tags: string[]
  synced_at: string
}

interface GHLStatus {
  connected: boolean
  location_id: string
  company_name: string
  city: string
  state: string
  contacts_count: number
  contacts: GHLContact[]
}

export function GHLIntegrationTab() {
  const [status, setStatus]           = useState<GHLStatus | null>(null)
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState<string | null>(null)
  const [copied, setCopied]           = useState(false)
  const [showContacts, setShowContacts] = useState(false)

  const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? ''
  const webhookUrl  = `${supabaseUrl}/functions/v1/ghl-webhook`

  async function loadStatus() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(GHL_STATUS_URL)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as GHLStatus
      setStatus(data)
    } catch {
      setError('Could not reach GHL. Check your connection or try again.')
    } finally {
      setLoading(false)
    }
  }

  async function copyWebhookUrl() {
    await navigator.clipboard.writeText(webhookUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="max-w-2xl space-y-6">
      {/* Section header */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900">GoHighLevel Integration</h2>
        <p className="text-sm text-gray-500 mt-1">
          DIGITRACKER is connected to the AM333 (DIGI5Y) GHL sub-account. View synced contacts and manage the integration.
        </p>
      </div>

      {/* ── Connection card ─────────────────────────────────────────────── */}
      {!status && !loading && !error && (
        <div className="bg-violet-50 border border-violet-200 rounded-2xl p-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-violet-600 text-white text-lg flex items-center justify-center flex-shrink-0">
              🔗
            </div>
            <div>
              <p className="font-semibold text-violet-900">AM333 (DIGI5Y) Sub-account</p>
              <p className="text-xs text-violet-600 mt-0.5">Click to verify live connection and load contacts</p>
            </div>
          </div>
          <button
            onClick={() => void loadStatus()}
            className="flex-shrink-0 bg-violet-600 text-white text-sm font-semibold rounded-xl px-5 py-2.5 hover:bg-violet-700 transition-colors"
          >
            Check Status
          </button>
        </div>
      )}

      {/* Loading spinner */}
      {loading && (
        <div className="flex justify-center py-10">
          <div className="w-8 h-8 border-4 border-violet-600 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-5 flex items-start gap-3">
          <span className="text-red-500 text-lg flex-shrink-0">⚠</span>
          <div>
            <p className="text-sm font-semibold text-red-800">Connection error</p>
            <p className="text-sm text-red-600 mt-0.5">{error}</p>
            <button
              onClick={() => void loadStatus()}
              className="mt-3 text-sm text-red-700 underline hover:text-red-900"
            >
              Try again
            </button>
          </div>
        </div>
      )}

      {/* Connected state */}
      {status?.connected && (
        <div className="bg-green-50 border border-green-200 rounded-2xl p-5 space-y-5">
          {/* Status row */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-green-600 text-white text-lg flex items-center justify-center flex-shrink-0">
                ✓
              </div>
              <div>
                <p className="font-semibold text-green-900">Connected — {status.company_name}</p>
                <p className="text-xs text-green-700 mt-0.5 font-mono">{status.location_id}</p>
              </div>
            </div>
            <button
              onClick={() => void loadStatus()}
              className="flex-shrink-0 text-sm text-green-700 hover:text-green-900 border border-green-300 rounded-lg px-3 py-1.5 transition-colors"
            >
              Refresh
            </button>
          </div>

          {/* Meta grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div className="bg-white rounded-xl p-3 border border-green-100">
              <p className="text-xs text-gray-400 mb-0.5">Location</p>
              <p className="text-xs text-gray-700">
                {[status.city, status.state].filter(Boolean).join(', ') || 'AM333'}
              </p>
            </div>
            <div className="bg-white rounded-xl p-3 border border-green-100">
              <p className="text-xs text-gray-400 mb-0.5">Total Contacts</p>
              <p className="text-xs text-gray-700 font-semibold">{status.contacts_count}</p>
            </div>
            <div className="bg-white rounded-xl p-3 border border-green-100 sm:col-span-2">
              <p className="text-xs text-gray-400 mb-0.5">Connection method</p>
              <p className="text-xs text-gray-600">Direct API (Private Integration Token) · AM333 Location</p>
            </div>
          </div>

          {/* Contact list */}
          <div className="border-t border-green-200 pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900">GHL Contacts</p>
                <p className="text-xs text-gray-500">Live from GoHighLevel · up to 50 shown</p>
              </div>
              <button
                onClick={() => setShowContacts(v => !v)}
                className="text-sm text-violet-600 hover:text-violet-800 border border-violet-200 rounded-lg px-3 py-1.5 transition-colors"
              >
                {showContacts ? 'Hide' : 'Show'}
              </button>
            </div>

            {showContacts && status.contacts.length === 0 && (
              <p className="text-sm text-gray-400 py-2">No contacts returned. Verify the PIT token has contacts.readonly scope.</p>
            )}

            {showContacts && status.contacts.length > 0 && (
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {status.contacts.map(c => (
                  <div
                    key={c.id}
                    className="flex items-center gap-3 bg-white rounded-xl px-3 py-2.5 border border-green-100"
                  >
                    <div className="w-8 h-8 rounded-full bg-violet-100 text-violet-700 text-xs font-bold flex items-center justify-center flex-shrink-0">
                      {c.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{c.name}</p>
                      <p className="text-xs text-gray-400 truncate">{c.email || c.phone || '—'}</p>
                    </div>
                    {c.tags.length > 0 && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-600 font-medium flex-shrink-0 truncate max-w-[80px]">
                        {c.tags[0]}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── What syncs card ─────────────────────────────────────────────────── */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-4">
        <h3 className="text-sm font-semibold text-gray-900">What syncs between DIGITRACKER &amp; GHL?</h3>
        <ul className="space-y-3">
          {[
            { icon: '👤', label: 'Contacts',  desc: 'GHL contacts visible in DIGITRACKER for team linking' },
            { icon: '🕐', label: 'Time Data', desc: 'Daily punch-in/out summaries pushed to GHL contact notes' },
            { icon: '📋', label: 'Tasks',     desc: 'Completed DIGITRACKER tasks logged as GHL conversation activity' },
            { icon: '🔔', label: 'Events',    desc: 'Real-time contact events received via GHL webhooks' },
          ].map(item => (
            <li key={item.label} className="flex items-start gap-3 text-sm">
              <span className="text-lg flex-shrink-0">{item.icon}</span>
              <span>
                <span className="font-medium text-gray-800">{item.label}</span>
                <span className="text-gray-400 mx-1.5">·</span>
                <span className="text-gray-600">{item.desc}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* ── Webhook URL card ────────────────────────────────────────────────── */}
      <div className="bg-gray-50 border border-gray-200 rounded-2xl p-5 space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Webhook Endpoint</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Add this URL in GHL → Settings → Integrations → Webhooks to receive real-time contact events.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <code className="flex-1 text-xs font-mono bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-gray-700 truncate">
            {webhookUrl || 'Not configured — set VITE_SUPABASE_URL'}
          </code>
          {webhookUrl && (
            <button
              onClick={() => void copyWebhookUrl()}
              className="text-xs font-medium border rounded-xl px-3 py-2.5 transition-colors flex-shrink-0 whitespace-nowrap border-violet-200 text-violet-600 hover:bg-violet-50"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
