import { useEffect, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'

// Redirect URI registered in the GHL Marketplace App.
// GHL redirects here after the user authorizes; index.html bridges it into HashRouter.
const GHL_REDIRECT_URI = 'https://digitracker.digi5y.co/ghl/callback'

// N8N live-status endpoint — returns connection info + contacts for the AM333 location.
const GHL_STATUS_URL = 'https://amwellinc.app.n8n.cloud/webhook/digitracker-ghl-status'

const GHL_SCOPES = [
  'contacts.readonly',
  'contacts.write',
  'locations.readonly',
  'calendars.readonly',
  'users.readonly',
].join(' ')

interface StoredInstallation {
  location_id:  string
  company_name: string
  sub_account:  string
  installed_at: string
}

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

function loadStoredInstallation(subAccount: string): StoredInstallation | null {
  try {
    const raw = localStorage.getItem('ghl_installation')
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredInstallation
    // Only use if it belongs to the current sub-account
    return parsed.sub_account === subAccount ? parsed : null
  } catch {
    return null
  }
}

export function GHLIntegrationTab() {
  const { user } = useAuth()

  const clientId    = (import.meta.env.VITE_GHL_CLIENT_ID as string | undefined) ?? ''
  const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL  as string | undefined) ?? ''
  const webhookUrl  = `${supabaseUrl}/functions/v1/ghl-webhook`

  // Stored OAuth installation (from localStorage after OAuth exchange)
  const [stored, setStored]   = useState<StoredInstallation | null>(null)

  // Live status from N8N (contacts + live GHL data)
  const [liveStatus, setLiveStatus] = useState<GHLStatus | null>(null)
  const [liveLoading, setLiveLoading] = useState(false)
  const [liveError, setLiveError]     = useState<string | null>(null)
  const [showContacts, setShowContacts] = useState(false)
  const [copied, setCopied] = useState(false)

  // Load stored installation on mount
  useEffect(() => {
    if (!user) return
    setStored(loadStoredInstallation(user.sub_account))
  }, [user])

  function buildOAuthUrl(): string {
    const params = new URLSearchParams({
      response_type: 'code',
      redirect_uri:  GHL_REDIRECT_URI,
      client_id:     clientId,
      scope:         GHL_SCOPES,
      state:         user?.sub_account ?? '',
    })
    return `https://marketplace.gohighlevel.com/oauth/chooselocation?${params.toString()}`
  }

  async function loadLiveStatus() {
    setLiveLoading(true)
    setLiveError(null)
    try {
      const res = await fetch(GHL_STATUS_URL)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setLiveStatus((await res.json()) as GHLStatus)
    } catch {
      setLiveError('Could not reach GHL live data. Check your connection or try again.')
    } finally {
      setLiveLoading(false)
    }
  }

  function handleDisconnect() {
    if (!window.confirm('Disconnect GoHighLevel? The stored token will be removed.')) return
    localStorage.removeItem('ghl_installation')
    setStored(null)
    setLiveStatus(null)
    setShowContacts(false)
  }

  async function copyWebhookUrl() {
    await navigator.clipboard.writeText(webhookUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // Use OAuth connection if available; fall back to live AM333 status if loaded
  const isConnected = !!(stored || liveStatus?.connected)
  const displayName = stored?.company_name || liveStatus?.company_name || 'GoHighLevel'
  const displayLoc  = stored?.location_id  || liveStatus?.location_id  || ''

  return (
    <div className="max-w-2xl space-y-6">

      {/* Section header */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900">GoHighLevel Integration</h2>
        <p className="text-sm text-gray-500 mt-1">
          Connect DIGITRACKER to your GHL sub-account to sync contacts, push time data, and automate CRM workflows.
        </p>
      </div>

      {/* ── Connection card ─────────────────────────────────────────────── */}
      {isConnected ? (
        <div className="bg-green-50 border border-green-200 rounded-2xl p-5 space-y-5">

          {/* Status row */}
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-green-600 text-white text-lg flex items-center justify-center flex-shrink-0">
                ✓
              </div>
              <div>
                <p className="font-semibold text-green-900">Connected — {displayName}</p>
                <p className="text-xs text-green-700 mt-0.5 font-mono">{displayLoc}</p>
              </div>
            </div>
            {stored && (
              <button
                onClick={handleDisconnect}
                className="flex-shrink-0 text-sm text-red-600 hover:text-red-800 border border-red-200 rounded-lg px-3 py-1.5 transition-colors"
              >
                Disconnect
              </button>
            )}
          </div>

          {/* Meta grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            {stored?.installed_at && (
              <div className="bg-white rounded-xl p-3 border border-green-100">
                <p className="text-xs text-gray-400 mb-0.5">Connected</p>
                <p className="text-xs text-gray-700">
                  {new Date(stored.installed_at).toLocaleDateString('en-SG', {
                    day: 'numeric', month: 'short', year: 'numeric',
                  })}
                </p>
              </div>
            )}
            {liveStatus && (
              <div className="bg-white rounded-xl p-3 border border-green-100">
                <p className="text-xs text-gray-400 mb-0.5">Total Contacts</p>
                <p className="text-xs text-gray-700 font-semibold">{liveStatus.contacts_count}</p>
              </div>
            )}
            <div className="bg-white rounded-xl p-3 border border-green-100 sm:col-span-2">
              <p className="text-xs text-gray-400 mb-0.5">Scopes granted</p>
              <p className="text-xs text-gray-600 leading-relaxed">
                {GHL_SCOPES.replace(/ /g, ' · ')}
              </p>
            </div>
          </div>

          {/* Live contacts section */}
          <div className="border-t border-green-200 pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900">Synced Contacts</p>
                <p className="text-xs text-gray-500">Live from GHL — up to 50 shown</p>
              </div>
              <button
                onClick={() => {
                  if (!liveStatus) {
                    void loadLiveStatus().then(() => setShowContacts(true))
                  } else {
                    setShowContacts(v => !v)
                  }
                }}
                disabled={liveLoading}
                className="text-sm text-violet-600 hover:text-violet-800 border border-violet-200 rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50"
              >
                {liveLoading ? 'Loading…' : showContacts ? 'Hide' : 'View'}
              </button>
            </div>

            {liveError && (
              <p className="text-sm text-red-500">{liveError}</p>
            )}

            {showContacts && liveStatus?.contacts.length === 0 && (
              <p className="text-sm text-gray-400 py-2">No contacts returned yet.</p>
            )}

            {showContacts && liveStatus && liveStatus.contacts.length > 0 && (
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {liveStatus.contacts.map(c => (
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

      ) : (
        /* ── Not connected ────────────────────────────────────────────── */
        <div className="border-2 border-dashed border-gray-200 rounded-2xl p-8 text-center space-y-5">
          <div className="w-16 h-16 rounded-2xl bg-violet-50 flex items-center justify-center text-3xl mx-auto">
            🔗
          </div>
          <div>
            <p className="font-semibold text-gray-900 text-lg">Not Connected</p>
            <p className="text-sm text-gray-500 mt-1 max-w-xs mx-auto">
              Link your GoHighLevel sub-account to sync contacts and automate data flows with DIGITRACKER.
            </p>
          </div>

          {clientId ? (
            <a
              href={buildOAuthUrl()}
              className="inline-flex items-center gap-2 bg-violet-600 text-white rounded-xl px-6 py-3 text-sm font-semibold hover:bg-violet-700 active:bg-violet-800 transition-colors"
            >
              Connect GoHighLevel →
            </a>
          ) : (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-700 text-left max-w-sm mx-auto">
              <strong>Setup required:</strong> The GHL Marketplace App credentials have not been configured yet.
              Contact your platform administrator or complete the GHL Marketplace App registration.
            </div>
          )}
        </div>
      )}

      {/* ── What syncs ──────────────────────────────────────────────────── */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-4">
        <h3 className="text-sm font-semibold text-gray-900">What syncs between DIGITRACKER &amp; GHL?</h3>
        <ul className="space-y-3">
          {[
            { icon: '👤', label: 'Contacts',  desc: 'GHL contacts mirrored as potential team members' },
            { icon: '🕐', label: 'Time Data', desc: 'Daily punch-in/out summaries pushed to GHL contact notes' },
            { icon: '📋', label: 'Tasks',     desc: 'Completed DIGITRACKER tasks logged as GHL conversation activity' },
            { icon: '🔔', label: 'Events',    desc: 'Real-time contact and appointment events received from GHL' },
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

      {/* ── Webhook URL ─────────────────────────────────────────────────── */}
      <div className="bg-gray-50 border border-gray-200 rounded-2xl p-5 space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Webhook Endpoint</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Add this URL in your GHL Marketplace App settings under "Webhook URL".
          </p>
        </div>
        <div className="flex items-center gap-2">
          <code className="flex-1 text-xs font-mono bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-gray-700 truncate">
            {webhookUrl || 'Not configured'}
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
        <div className="pt-1">
          <p className="text-xs text-gray-500 mb-1.5">OAuth Redirect URI (register in GHL App):</p>
          <code className="block text-xs font-mono bg-white border border-gray-200 rounded-xl px-3 py-2 text-gray-600 break-all">
            {GHL_REDIRECT_URI}
          </code>
        </div>
      </div>

    </div>
  )
}
