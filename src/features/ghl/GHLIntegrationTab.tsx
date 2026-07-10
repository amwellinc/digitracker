import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'

interface GHLInstallation {
  id: string
  ghl_location_id: string
  ghl_company_id: string | null
  scope: string | null
  installed_at: string
  updated_at: string
}

interface GHLContactLink {
  id: string
  ghl_contact_id: string
  ghl_email: string | null
  ghl_name: string | null
  ghl_phone: string | null
  user_id: string | null
  synced_at: string
}

const GHL_SCOPES = [
  'contacts.readonly',
  'contacts.write',
  'locations.readonly',
  'calendars.readonly',
  'users.readonly',
].join(' ')

export function GHLIntegrationTab() {
  const { user } = useAuth()

  const [installation, setInstallation]     = useState<GHLInstallation | null>(null)
  const [contacts, setContacts]             = useState<GHLContactLink[]>([])
  const [loading, setLoading]               = useState(true)
  const [disconnecting, setDisconnecting]   = useState(false)
  const [contactsLoading, setContactsLoading] = useState(false)
  const [contactsLoaded, setContactsLoaded] = useState(false)
  const [copied, setCopied]                 = useState(false)

  const clientId    = (import.meta.env.VITE_GHL_CLIENT_ID  as string | undefined) ?? ''
  const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL   as string | undefined) ?? ''
  const webhookUrl  = `${supabaseUrl}/functions/v1/ghl-webhook`

  useEffect(() => {
    if (!user) return
    void loadInstallation()
  }, [user])

  async function loadInstallation() {
    setLoading(true)
    const { data } = await supabase
      .from('ghl_installations')
      .select('id, ghl_location_id, ghl_company_id, scope, installed_at, updated_at')
      .eq('sub_account', user!.sub_account)
      .maybeSingle()
    setInstallation(data as GHLInstallation | null)
    setLoading(false)
  }

  async function loadContacts() {
    if (!user) return
    setContactsLoading(true)
    const { data } = await supabase
      .from('ghl_contact_links')
      .select('*')
      .eq('sub_account', user.sub_account)
      .order('ghl_name', { ascending: true })
      .limit(50)
    setContacts((data ?? []) as GHLContactLink[])
    setContactsLoading(false)
    setContactsLoaded(true)
  }

  async function handleDisconnect() {
    if (!user || !installation) return
    if (!window.confirm('Disconnect GoHighLevel? The OAuth token will be removed and auto-sync will stop.')) return
    setDisconnecting(true)
    await supabase.from('ghl_installations').delete().eq('sub_account', user.sub_account)
    await supabase
      .from('sub_accounts')
      .update({ ghl_location_id: null, ghl_connected_at: null })
      .eq('code', user.sub_account)
    setInstallation(null)
    setContacts([])
    setContactsLoaded(false)
    setDisconnecting(false)
  }

  function buildOAuthUrl(): string {
    const callbackUri = `${supabaseUrl}/functions/v1/ghl-oauth-callback`
    const params = new URLSearchParams({
      response_type: 'code',
      redirect_uri:  callbackUri,
      client_id:     clientId,
      scope:         GHL_SCOPES,
      state:         user?.sub_account ?? '',
    })
    return `https://marketplace.gohighlevel.com/oauth/chooselocation?${params.toString()}`
  }

  async function copyWebhookUrl() {
    await navigator.clipboard.writeText(webhookUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="w-8 h-8 border-4 border-violet-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
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

      {/* ── Connection card ─────────────────────────────────────────────────── */}
      {installation ? (
        <div className="bg-green-50 border border-green-200 rounded-2xl p-5 space-y-5">
          {/* Status row */}
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-green-600 text-white text-lg flex items-center justify-center flex-shrink-0">
                ✓
              </div>
              <div>
                <p className="font-semibold text-green-900">Connected to GoHighLevel</p>
                <p className="text-xs text-green-700 mt-0.5 font-mono">
                  {installation.ghl_location_id}
                </p>
              </div>
            </div>
            <button
              onClick={() => void handleDisconnect()}
              disabled={disconnecting}
              className="flex-shrink-0 text-sm text-red-600 hover:text-red-800 border border-red-200 rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50"
            >
              {disconnecting ? 'Disconnecting…' : 'Disconnect'}
            </button>
          </div>

          {/* Meta grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            {installation.ghl_company_id && (
              <div className="bg-white rounded-xl p-3 border border-green-100">
                <p className="text-xs text-gray-400 mb-0.5">Company ID</p>
                <p className="font-mono text-xs text-gray-700 truncate">{installation.ghl_company_id}</p>
              </div>
            )}
            <div className="bg-white rounded-xl p-3 border border-green-100">
              <p className="text-xs text-gray-400 mb-0.5">Connected</p>
              <p className="text-xs text-gray-700">
                {new Date(installation.installed_at).toLocaleDateString('en-SG', {
                  day: 'numeric', month: 'short', year: 'numeric',
                })}
              </p>
            </div>
            {installation.scope && (
              <div className="bg-white rounded-xl p-3 border border-green-100 sm:col-span-2">
                <p className="text-xs text-gray-400 mb-0.5">Scopes granted</p>
                <p className="text-xs text-gray-600 leading-relaxed">{installation.scope.replace(/ /g, ' · ')}</p>
              </div>
            )}
          </div>

          {/* Contact sync */}
          <div className="border-t border-green-200 pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900">Synced Contacts</p>
                <p className="text-xs text-gray-500">GHL contacts received via webhook</p>
              </div>
              <button
                onClick={() => void loadContacts()}
                disabled={contactsLoading}
                className="text-sm text-violet-600 hover:text-violet-800 border border-violet-200 rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50"
              >
                {contactsLoading ? 'Loading…' : contactsLoaded ? 'Refresh' : 'View'}
              </button>
            </div>

            {contactsLoaded && contacts.length === 0 && (
              <p className="text-sm text-gray-400 py-2">
                No contacts synced yet. Contact events arrive automatically when GHL webhooks are configured.
              </p>
            )}

            {contacts.length > 0 && (
              <div className="space-y-1.5 max-h-52 overflow-y-auto">
                {contacts.map(c => (
                  <div
                    key={c.id}
                    className="flex items-center gap-3 bg-white rounded-xl px-3 py-2.5 border border-green-100"
                  >
                    <div className="w-8 h-8 rounded-full bg-violet-100 text-violet-700 text-xs font-bold flex items-center justify-center flex-shrink-0">
                      {(c.ghl_name ?? '?').slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{c.ghl_name ?? '—'}</p>
                      <p className="text-xs text-gray-400 truncate">{c.ghl_email ?? c.ghl_phone ?? '—'}</p>
                    </div>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 ${
                      c.user_id
                        ? 'bg-green-100 text-green-700'
                        : 'bg-gray-100 text-gray-400'
                    }`}>
                      {c.user_id ? 'Linked' : 'Unlinked'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* ── Not connected ──────────────────────────────────────────────── */
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
              <strong>Setup required:</strong> Set{' '}
              <code className="font-mono text-xs bg-amber-100 px-1 rounded">VITE_GHL_CLIENT_ID</code>{' '}
              in the environment config to enable OAuth. Contact your platform administrator.
            </div>
          )}
        </div>
      )}

      {/* ── What syncs card ─────────────────────────────────────────────────── */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-4">
        <h3 className="text-sm font-semibold text-gray-900">What syncs between DIGITRACKER &amp; GHL?</h3>
        <ul className="space-y-3">
          {[
            { icon: '👤', label: 'Contacts',  desc: 'GHL contacts mirrored as potential team members via webhook' },
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

      {/* ── Webhook URL card ────────────────────────────────────────────────── */}
      <div className="bg-gray-50 border border-gray-200 rounded-2xl p-5 space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Webhook Endpoint</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Add this URL in your GHL Marketplace App settings under "Webhook URL" to receive real-time events.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <code className="flex-1 text-xs font-mono bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-gray-700 truncate">
            {webhookUrl}
          </code>
          <button
            onClick={() => void copyWebhookUrl()}
            className="text-xs font-medium border rounded-xl px-3 py-2.5 transition-colors flex-shrink-0 whitespace-nowrap min-h-[44px] sm:min-h-0 border-violet-200 text-violet-600 hover:bg-violet-50"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>

        {/* OAuth callback URL */}
        <div className="pt-1">
          <p className="text-xs text-gray-500 mb-1.5">OAuth Redirect URI (set in GHL App credentials):</p>
          <code className="block text-xs font-mono bg-white border border-gray-200 rounded-xl px-3 py-2 text-gray-600 truncate">
            {supabaseUrl}/functions/v1/ghl-oauth-callback
          </code>
        </div>
      </div>
    </div>
  )
}
