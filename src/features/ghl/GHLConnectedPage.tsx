import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

// oauth-callback (edge function) does the full authorization-code
// exchange server-side — GHL redirects there directly, never to the app —
// then redirects the browser here with the outcome in the query string.
// This page only ever displays that outcome; it never handles a code or
// talks to GHL itself.
interface HashResult {
  status: string | null
  reason: string
  locationId: string
}

function readHashResult(): HashResult {
  const hash = window.location.hash          // e.g. #/ghl/connected?status=success&location_id=XYZ
  const qIdx = hash.indexOf('?')
  const params = new URLSearchParams(qIdx >= 0 ? hash.slice(qIdx + 1) : '')
  return {
    status:     params.get('status'),
    reason:     params.get('reason') ?? '',
    locationId: params.get('location_id') ?? '',
  }
}

const KNOWN_ERRORS: Record<string, string> = {
  token_exchange_failed: 'Failed to exchange OAuth token with GoHighLevel. Please try again.',
  db_error:              'Failed to save the connection. Please try again.',
  missing_params:        'Incomplete OAuth response from GHL. Please try again.',
  not_configured:        'GHL OAuth is not configured yet. Contact your administrator.',
  network_error:         'Network error during token exchange. Please check your connection.',
  access_denied:         'You cancelled the GoHighLevel authorization. No changes were made.',
}

export function GHLConnectedPage() {
  const navigate = useNavigate()
  const [result] = useState<HashResult>(readHashResult)
  const phase: 'success' | 'error' = result.status === 'success' ? 'success' : 'error'

  useEffect(() => {
    if (phase !== 'success') return
    const t = setTimeout(() => navigate('/settings', { replace: true }), 3500)
    return () => clearTimeout(t)
  }, [phase, navigate])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-violet-50/30 p-4">
      <div className="bg-white p-8 rounded-2xl shadow-lg shadow-gray-200/80 max-w-md w-full space-y-5 border border-gray-100 text-center">

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
              {result.locationId && (
                <p className="text-xs text-gray-400 mt-2 font-mono">Location: {result.locationId}</p>
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
                {KNOWN_ERRORS[result.reason] ?? 'An unexpected error occurred. Please try again.'}
              </p>
              {result.reason && !KNOWN_ERRORS[result.reason] && (
                <p className="text-xs text-gray-400 mt-1 font-mono">{result.reason}</p>
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
