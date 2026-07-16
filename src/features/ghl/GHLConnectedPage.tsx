import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

// N8N workflow that exchanges the GHL authorization code for tokens server-side.
// Client secret stays in N8N — never in the browser.
const N8N_EXCHANGE_URL = 'https://amwellinc.app.n8n.cloud/webhook/ghl-oauth-exchange'

// OAuth redirect URI registered in GHL Marketplace App settings.
const GHL_REDIRECT_URI = 'https://digitracker-app.digi5y.co/ghl/callback'

interface ExchangeResult {
  success: boolean
  location_id?: string
  company_name?: string
  reason?: string
}

// Reads query params from the hash fragment (supports both ?key=value and #/route?key=value)
function hashParams(): URLSearchParams {
  const hash = window.location.hash          // e.g. #/ghl/callback?code=ABC&state=XYZ
  const qIdx = hash.indexOf('?')
  return new URLSearchParams(qIdx >= 0 ? hash.slice(qIdx + 1) : '')
}

const KNOWN_ERRORS: Record<string, string> = {
  token_exchange_failed: 'Failed to exchange OAuth token with GoHighLevel. Please try again.',
  db_error:             'Failed to save the connection. Please try again.',
  missing_params:       'Incomplete OAuth response from GHL. Please try again.',
  not_configured:       'GHL OAuth is not configured yet. Contact your administrator.',
  network_error:        'Network error during token exchange. Please check your connection.',
  access_denied:        'You cancelled the GoHighLevel authorization. No changes were made.',
}

type Phase = 'exchanging' | 'success' | 'error'

export function GHLConnectedPage() {
  const navigate    = useNavigate()
  const params      = hashParams()
  const code        = params.get('code')
  const state       = params.get('state')      // sub_account code passed as OAuth state
  const statusParam = params.get('status')     // legacy: Supabase edge function sets this
  const reasonParam = params.get('reason') ?? ''
  const locationId  = params.get('location_id') ?? ''

  // Determine initial phase
  const initialPhase: Phase = code
    ? 'exchanging'
    : statusParam === 'success'
    ? 'success'
    : 'error'

  const [phase, setPhase]         = useState<Phase>(initialPhase)
  const [connLocation, setConnLocation] = useState(locationId)
  const [errorReason, setErrorReason]   = useState(reasonParam)
  const exchanged = useRef(false)

  // Exchange the authorization code for tokens via N8N (server-side)
  useEffect(() => {
    if (!code || exchanged.current) return
    exchanged.current = true

    void (async () => {
      try {
        const res = await fetch(N8N_EXCHANGE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code,
            state:        state ?? '',
            redirect_uri: GHL_REDIRECT_URI,
          }),
        })
        const data = (await res.json()) as ExchangeResult
        if (data.success) {
          // Persist locally so GHLIntegrationTab shows "Connected" immediately.
          // This is a bridge until Supabase migration 013 is applied — at which
          // point the Supabase edge function takes over as the canonical store.
          localStorage.setItem(
            'ghl_installation',
            JSON.stringify({
              location_id:  data.location_id  ?? '',
              company_name: data.company_name ?? '',
              sub_account:  state             ?? '',
              installed_at: new Date().toISOString(),
            }),
          )
          setConnLocation(data.location_id ?? '')
          setPhase('success')
        } else {
          setErrorReason(data.reason ?? 'token_exchange_failed')
          setPhase('error')
        }
      } catch {
        setErrorReason('network_error')
        setPhase('error')
      }
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-redirect to Settings after success
  useEffect(() => {
    if (phase !== 'success') return
    const t = setTimeout(() => navigate('/settings', { replace: true }), 3500)
    return () => clearTimeout(t)
  }, [phase, navigate])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-violet-50/30 p-4">
      <div className="bg-white p-8 rounded-2xl shadow-lg shadow-gray-200/80 max-w-md w-full space-y-5 border border-gray-100 text-center">

        {phase === 'exchanging' && (
          <>
            <div className="w-16 h-16 rounded-full bg-violet-100 flex items-center justify-center mx-auto">
              <div className="w-8 h-8 border-4 border-violet-600 border-t-transparent rounded-full animate-spin" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">Connecting GoHighLevel…</h1>
              <p className="text-sm text-gray-500 mt-1.5">
                Exchanging authorization code for tokens. This only takes a moment.
              </p>
            </div>
          </>
        )}

        {phase === 'success' && (
          <>
            <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center text-3xl mx-auto">
              ✅
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">GoHighLevel Connected!</h1>
              <p className="text-sm text-gray-500 mt-1.5">
                Your GHL sub-account has been successfully linked to DIGITRACKER.
              </p>
              {connLocation && (
                <p className="text-xs text-gray-400 mt-2 font-mono">Location: {connLocation}</p>
              )}
            </div>
            <div className="flex items-center justify-center gap-2 text-xs text-gray-400">
              <div className="w-4 h-4 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
              Redirecting to Settings…
            </div>
          </>
        )}

        {phase === 'error' && (
          <>
            <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center text-3xl mx-auto">
              ❌
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">Connection Failed</h1>
              <p className="text-sm text-gray-500 mt-1.5">
                {KNOWN_ERRORS[errorReason] ?? 'An unexpected error occurred. Please try again.'}
              </p>
              {errorReason && !KNOWN_ERRORS[errorReason] && (
                <p className="text-xs text-gray-400 mt-1 font-mono">{errorReason}</p>
              )}
            </div>
            <button
              onClick={() => navigate('/settings', { replace: true })}
              className="text-sm font-medium text-violet-600 hover:underline"
            >
              ← Back to Settings
            </button>
          </>
        )}

      </div>
    </div>
  )
}
