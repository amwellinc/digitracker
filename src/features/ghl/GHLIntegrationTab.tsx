import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import { useRealtime } from '@/hooks/useRealtime'

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? ''

// Redirect URI to register in the GHL Marketplace App — must point at the
// edge function that performs the token exchange, not the app itself. GHL
// redirects the browser here directly with ?code=&state=; the function
// exchanges the code server-side (client secret never reaches the browser)
// and only then redirects the browser on to /#/ghl/connected.
//
// Named oauth-callback / crm-webhook, not ghl-oauth-callback / ghl-webhook:
// GHL's own validation rejects a redirect_uri (and apparently webhook URL)
// that contains "ghl" anywhere in the path.
const GHL_REDIRECT_URI = `${SUPABASE_URL}/functions/v1/oauth-callback`
const GHL_WEBHOOK_URL  = `${SUPABASE_URL}/functions/v1/crm-webhook`

const GHL_SCOPES = [
  'contacts.readonly',
  'contacts.write',
  'locations.readonly',
  'users.readonly',
].join(' ')

interface Installation {
  id: string
  sub_account: string
  ghl_location_id: string
  ghl_company_id: string | null
  ghl_user_id: string | null
  scope: string | null
  expires_at: string
  installed_at: string
  updated_at: string
}

interface ContactLink {
  id: string
  ghl_contact_id: string
  ghl_name: string | null
  ghl_email: string | null
  ghl_phone: string | null
  synced_at: string
}

export function GHLIntegrationTab() {
  const { user } = useAuth()

  const clientId = (import.meta.env.VITE_GHL_CLIENT_ID as string | undefined) || ''

  const [installation, setInstallation] = useState<Installation | null>(null)
  const [contacts, setContacts]         = useState<ContactLink[]>([])
  const [loading, setLoading]           = useState(true)
  const [showContacts, setShowContacts] = useState(false)
  const [refreshing, setRefreshing]     = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [actionError, setActionError]   = useState<string | null>(null)
  const [actionMsg, setActionMsg]       = useState<string | null>(null)
  const [copied, setCopied]             = useState<'webhook' | 'redirect' | null>(null)

  const load = useCallback(async () => {
    if (!user) return
    const [{ data: inst }, { data: links }] = await Promise.all([
      // SECURITY DEFINER RPC, not a direct table select: it returns only
      // non-sensitive columns, so access_token/refresh_token can never leak
      // through this call regardless of what the client asks for.
      supabase.rpc('get_ghl_installation').maybeSingle(),
      supabase
        .from('ghl_contact_links')
        .select('id, ghl_contact_id, ghl_name, ghl_email, ghl_phone, synced_at')
        .eq('sub_account', user.sub_account)
        .order('synced_at', { ascending: false })
        .limit(50),
    ])
    setInstallation(inst as Installation | null)
    setContacts((links ?? []) as ContactLink[])
    setLoading(false)
  }, [user])

  useEffect(() => { void load() }, [load])

  const handleChange = useCallback(() => { void load() }, [load])
  useRealtime({ table: 'ghl_installations', filter: `sub_account=eq.${user?.sub_account ?? ''}`, onInsert: handleChange, onUpdate: handleChange, onDelete: handleChange })

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

  async function handleRefresh() {
    setRefreshing(true)
    setActionError(null)
    setActionMsg(null)
    const { data, error } = await supabase.functions.invoke('ghl-refresh-token')
    setRefreshing(false)
    const result = data as { success?: boolean; error?: string } | null
    if (error || !result?.success) {
      setActionError(result?.error ?? error?.message ?? 'Could not refresh the connection.')
      return
    }
    setActionMsg('Connection refreshed.')
    void load()
    setTimeout(() => setActionMsg(null), 3000)
  }

  async function handleDisconnect() {
    if (!window.confirm('Disconnect GoHighLevel? Stored tokens will be removed and contact sync will stop.')) return
    setDisconnecting(true)
    setActionError(null)
    const { data, error } = await supabase.functions.invoke('ghl-disconnect')
    setDisconnecting(false)
    const result = data as { success?: boolean; error?: string } | null
    if (error || !result?.success) {
      setActionError(result?.error ?? error?.message ?? 'Could not disconnect.')
      return
    }
    setInstallation(null)
    setContacts([])
    setShowContacts(false)
  }

  async function copyToClipboard(text: string, which: 'webhook' | 'redirect') {
    await navigator.clipboard.writeText(text)
    setCopied(which)
    setTimeout(() => setCopied(null), 2000)
  }

  const isConnected = !!installation
  const isExpiringSoon = installation ? new Date(installation.expires_at).getTime() - Date.now() < 60 * 60 * 1000 : false

  if (loading) {
    return <div className="max-w-2xl py-12 text-center text-sm text-gray-400">Loading…</div>
  }

  return (
    <div className="max-w-2xl space-y-6">

      {/* Section header */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900">GoHighLevel Integration</h2>
        <p className="text-sm text-gray-500 mt-1">
          Connect DIGITRACKER to your GHL sub-account to sync contacts, push time data, and automate CRM workflows.
        </p>
      </div>

      {(actionError || actionMsg) && (
        <div className={`px-4 py-3 rounded-xl text-sm ${actionError ? 'bg-red-50 border border-red-200 text-red-700' : 'bg-green-50 border border-green-200 text-green-700'}`}>
          {actionError ?? actionMsg}
        </div>
      )}

      {/* ── Connection card ─────────────────────────────────────────────── */}
      {isConnected && installation ? (
        <div className="bg-green-50 border border-green-200 rounded-2xl p-5 space-y-5">

          {/* Status row */}
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-green-600 text-white text-lg flex items-center justify-center flex-shrink-0">
                ✓
              </div>
              <div>
                <p className="font-semibold text-green-900">Connected</p>
                <p className="text-xs text-green-700 mt-0.5 font-mono">{installation.ghl_location_id}</p>
              </div>
            </div>
            <div className="flex flex-shrink-0 gap-2">
              <button
                onClick={() => void handleRefresh()}
                disabled={refreshing}
                className="text-sm text-violet-600 hover:text-violet-800 border border-violet-200 rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50"
              >
                {refreshing ? 'Refreshing…' : 'Refresh'}
              </button>
              <button
                onClick={() => void handleDisconnect()}
                disabled={disconnecting}
                className="text-sm text-red-600 hover:text-red-800 border border-red-200 rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50"
              >
                {disconnecting ? '…' : 'Disconnect'}
              </button>
            </div>
          </div>

          {isExpiringSoon && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              This connection's token expires soon — click Refresh to keep it active.
            </p>
          )}

          {/* Meta grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div className="bg-white rounded-xl p-3 border border-green-100">
              <p className="text-xs text-gray-400 mb-0.5">Connected</p>
              <p className="text-xs text-gray-700">
                {new Date(installation.installed_at).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })}
              </p>
            </div>
            <div className="bg-white rounded-xl p-3 border border-green-100">
              <p className="text-xs text-gray-400 mb-0.5">Synced Contacts</p>
              <p className="text-xs text-gray-700 font-semibold">{contacts.length}</p>
            </div>
            <div className="bg-white rounded-xl p-3 border border-green-100 sm:col-span-2">
              <p className="text-xs text-gray-400 mb-0.5">Scopes granted</p>
              <p className="text-xs text-gray-600 leading-relaxed">
                {(installation.scope ?? GHL_SCOPES).replace(/ /g, ' · ')}
              </p>
            </div>
          </div>

          {/* Contacts section */}
          <div className="border-t border-green-200 pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900">Synced Contacts</p>
                <p className="text-xs text-gray-500">From GHL webhooks — up to 50 shown</p>
              </div>
              <button
                onClick={() => setShowContacts(v => !v)}
                className="text-sm text-violet-600 hover:text-violet-800 border border-violet-200 rounded-lg px-3 py-1.5 transition-colors"
              >
                {showContacts ? 'Hide' : 'View'}
              </button>
            </div>

            {showContacts && contacts.length === 0 && (
              <p className="text-sm text-gray-400 py-2">No contacts synced yet.</p>
            )}

            {showContacts && contacts.length > 0 && (
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {contacts.map(c => (
                  <div
                    key={c.id}
                    className="flex items-center gap-3 bg-white rounded-xl px-3 py-2.5 border border-green-100"
                  >
                    <div className="w-8 h-8 rounded-full bg-violet-100 text-violet-700 text-xs font-bold flex items-center justify-center flex-shrink-0">
                      {(c.ghl_name || '?').slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{c.ghl_name || 'Unnamed contact'}</p>
                      <p className="text-xs text-gray-400 truncate">{c.ghl_email || c.ghl_phone || '—'}</p>
                    </div>
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
            { icon: '🔔', label: 'Events',    desc: 'Real-time contact create/update events received from GHL' },
            { icon: '🔌', label: 'Install state', desc: 'App install/uninstall from GHL kept in sync automatically' },
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

      {/* ── Marketplace App configuration ──────────────────────────────── */}
      <div className="bg-gray-50 border border-gray-200 rounded-2xl p-5 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Marketplace App Configuration</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Register these URLs in your GHL Marketplace Developer app settings.
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-1.5">OAuth Redirect URI:</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs font-mono bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-gray-700 break-all">
              {GHL_REDIRECT_URI || 'Not configured'}
            </code>
            {GHL_REDIRECT_URI && (
              <button
                onClick={() => void copyToClipboard(GHL_REDIRECT_URI, 'redirect')}
                className="text-xs font-medium border rounded-xl px-3 py-2.5 transition-colors flex-shrink-0 whitespace-nowrap border-violet-200 text-violet-600 hover:bg-violet-50"
              >
                {copied === 'redirect' ? 'Copied!' : 'Copy'}
              </button>
            )}
          </div>
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-1.5">Webhook URL:</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs font-mono bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-gray-700 break-all">
              {GHL_WEBHOOK_URL || 'Not configured'}
            </code>
            {GHL_WEBHOOK_URL && (
              <button
                onClick={() => void copyToClipboard(GHL_WEBHOOK_URL, 'webhook')}
                className="text-xs font-medium border rounded-xl px-3 py-2.5 transition-colors flex-shrink-0 whitespace-nowrap border-violet-200 text-violet-600 hover:bg-violet-50"
              >
                {copied === 'webhook' ? 'Copied!' : 'Copy'}
              </button>
            )}
          </div>
        </div>
        <div className="pt-2 border-t border-gray-200 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <Link to="/privacy" target="_blank" className="text-violet-600 hover:underline">Privacy Policy →</Link>
          <Link to="/terms" target="_blank" className="text-violet-600 hover:underline">Terms of Service →</Link>
        </div>
      </div>

    </div>
  )
}
