import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'

export function ResetPasswordPage() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm]   = useState('')
  const [showPass, setShowPass] = useState(false)
  const [status, setStatus]     = useState<'idle' | 'loading' | 'done' | 'error' | 'invalid'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [ready, setReady]       = useState(false)
  const [timedOut, setTimedOut] = useState(false)

  useEffect(() => {
    // index.html bridges /auth/reset?code=XXX → /#/reset-password?code=XXX
    // The code ends up in the hash because HashRouter puts everything there.
    // Supabase JS only looks in window.location.search — we must exchange manually.
    const hash   = window.location.hash           // e.g. "#/reset-password?code=XXXX"
    const qIdx   = hash.indexOf('?')
    const params = new URLSearchParams(qIdx >= 0 ? hash.slice(qIdx + 1) : '')
    const code   = params.get('code')

    if (code) {
      void supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
        if (error) setStatus('invalid')
        else setReady(true)
      })
      return
    }

    // Fallback path: no code in URL (direct navigation or implicit-flow legacy link).
    // Check for an existing recovery session, then listen for auth events.
    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setReady(true)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') setReady(true)
    })

    // If nothing resolves in 8 s the link is almost certainly expired.
    const t = setTimeout(() => setTimedOut(true), 8000)

    return () => {
      subscription.unsubscribe()
      clearTimeout(t)
    }
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) {
      setErrorMsg('Passwords do not match.')
      setStatus('error')
      return
    }
    if (password.length < 8) {
      setErrorMsg('Password must be at least 8 characters.')
      setStatus('error')
      return
    }
    setStatus('loading')
    setErrorMsg('')

    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      setErrorMsg(error.message)
      setStatus('error')
      return
    }
    setStatus('done')
    setTimeout(() => navigate('/'), 2500)
  }

  // ── Success ─────────────────────────────────────────────────────────────────
  if (status === 'done') {
    return (
      <Screen>
        <div className="text-center space-y-3">
          <div className="text-5xl">✅</div>
          <h2 className="text-xl font-bold text-gray-900">Password set!</h2>
          <p className="text-sm text-gray-500">
            Your password has been updated. Redirecting you to the app…
          </p>
        </div>
      </Screen>
    )
  }

  // ── Expired / invalid link ───────────────────────────────────────────────────
  if (status === 'invalid' || (timedOut && !ready)) {
    return (
      <Screen>
        <div className="text-center space-y-4">
          <div className="text-5xl">🔗</div>
          <h2 className="text-xl font-bold text-gray-900">Link expired</h2>
          <p className="text-sm text-gray-500">
            This reset link has expired or has already been used.
            Reset links are valid for <strong>1 hour</strong> and can only be clicked once.
          </p>
          <button
            onClick={() => navigate('/login')}
            className="inline-flex items-center gap-1.5 bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold rounded-xl px-5 py-2.5 transition-colors"
          >
            Request a new link →
          </button>
        </div>
      </Screen>
    )
  }

  // ── Verifying ───────────────────────────────────────────────────────────────
  if (!ready) {
    return (
      <Screen>
        <div className="text-center space-y-4">
          <div className="w-10 h-10 border-4 border-violet-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-600 font-medium">Verifying your reset link…</p>
          <p className="text-xs text-gray-400">
            This only takes a moment. If it takes too long, the link may have expired.
          </p>
        </div>
      </Screen>
    )
  }

  // ── Set password form ────────────────────────────────────────────────────────
  return (
    <Screen>
      <div className="text-center mb-2">
        <img src="/logo.png" alt="DIGITRACKER" className="w-14 h-14 object-contain mx-auto mb-3" />
        <h2 className="text-xl font-bold text-gray-900">Set your password</h2>
        <p className="text-sm text-gray-500 mt-1">Choose a strong password for your account.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">New password</label>
          <div className="relative">
            <input
              type={showPass ? 'text' : 'password'}
              required
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              className="input pr-14"
            />
            <button
              type="button"
              onClick={() => setShowPass(p => !p)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-600"
            >
              {showPass ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Confirm password</label>
          <input
            type={showPass ? 'text' : 'password'}
            required
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            placeholder="Repeat your password"
            className="input"
          />
        </div>

        {password.length > 0 && (
          <div className="text-xs space-y-0.5">
            <p className={password.length >= 8 ? 'text-green-600' : 'text-red-500'}>
              {password.length >= 8 ? '✓' : '✗'} At least 8 characters
            </p>
            <p className={/[A-Z]/.test(password) ? 'text-green-600' : 'text-gray-400'}>
              {/[A-Z]/.test(password) ? '✓' : '○'} Uppercase letter
            </p>
            <p className={/[0-9]/.test(password) ? 'text-green-600' : 'text-gray-400'}>
              {/[0-9]/.test(password) ? '✓' : '○'} Number
            </p>
          </div>
        )}

        {status === 'error' && (
          <p className="text-sm text-red-600">{errorMsg}</p>
        )}

        <button
          type="submit"
          disabled={status === 'loading'}
          className="w-full bg-violet-600 hover:bg-violet-700 text-white rounded-lg py-2.5 text-sm font-semibold disabled:opacity-50 transition-colors"
        >
          {status === 'loading' ? 'Setting password…' : 'Set Password'}
        </button>

        <div className="text-center">
          <button
            type="button"
            onClick={() => navigate('/login')}
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            ← Back to login
          </button>
        </div>
      </form>
    </Screen>
  )
}

function Screen({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="bg-white p-8 rounded-2xl shadow-lg max-w-sm w-full">
        {children}
      </div>
    </div>
  )
}
