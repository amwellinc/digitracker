import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

// Parses ?key=value from the hash fragment (after '#/ghl/connected')
function hashParams(): URLSearchParams {
  const hash = window.location.hash
  const qIdx = hash.indexOf('?')
  return new URLSearchParams(qIdx >= 0 ? hash.slice(qIdx + 1) : '')
}

const ERROR_MESSAGES: Record<string, string> = {
  token_exchange_failed: 'Failed to exchange OAuth token with GoHighLevel. Please try again.',
  db_error:             'Failed to save the connection. Please try again.',
  missing_params:       'Incomplete OAuth response from GHL. Please try again.',
  not_configured:       'GHL OAuth is not configured on the server. Contact your administrator.',
  network_error:        'Network error during token exchange. Please check your connection.',
}

export function GHLConnectedPage() {
  const navigate = useNavigate()
  const params   = hashParams()
  const status     = params.get('status')   ?? 'error'
  const locationId = params.get('location_id')
  const reason     = params.get('reason')   ?? ''

  const isSuccess = status === 'success'

  useEffect(() => {
    if (!isSuccess) return
    const timer = setTimeout(() => navigate('/settings', { replace: true }), 3500)
    return () => clearTimeout(timer)
  }, [isSuccess, navigate])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-violet-50/30 p-4">
      <div className="bg-white p-8 rounded-2xl shadow-lg shadow-gray-200/80 max-w-md w-full space-y-5 border border-gray-100 text-center">
        {isSuccess ? (
          <>
            <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center text-3xl mx-auto">
              ✅
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">GoHighLevel Connected!</h1>
              <p className="text-sm text-gray-500 mt-1.5">
                Your GHL sub-account has been successfully linked to DIGITRACKER.
              </p>
              {locationId && (
                <p className="text-xs text-gray-400 mt-2 font-mono">
                  Location: {locationId}
                </p>
              )}
            </div>
            <div className="flex items-center justify-center gap-2 text-xs text-gray-400">
              <div className="w-4 h-4 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
              Redirecting to Settings…
            </div>
          </>
        ) : (
          <>
            <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center text-3xl mx-auto">
              ❌
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">Connection Failed</h1>
              <p className="text-sm text-gray-500 mt-1.5">
                {ERROR_MESSAGES[reason] ?? 'An unexpected error occurred. Please try again.'}
              </p>
              {reason && !ERROR_MESSAGES[reason] && (
                <p className="text-xs text-gray-400 mt-1 font-mono">{reason}</p>
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
