import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'

type Mode = 'password' | 'magic' | 'forgot'

interface AuthFormProps {
  accountType: 'team' | 'platform'
}

// The sign-in state machine (password / magic-link / forgot-password), shared
// by the customer-facing /login page and the separate /platform-login page.
// Page-level components own all surrounding chrome (branding, layout, CTAs) —
// this only renders the form itself, scoped to a fixed account type.
export function AuthForm({ accountType }: AuthFormProps) {
  const { signIn, signInWithPassword, sendPasswordReset, user, accountBlockedMessage } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (user) navigate('/', { replace: true })
  }, [user, navigate])

  const [mode, setMode]         = useState<Mode>('password')
  const [email, setEmail]       = useState('')
  const [subAccount, setSubAccount] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [status, setStatus]     = useState<'idle' | 'loading' | 'sent' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    if (accountBlockedMessage) {
      setErrorMsg(accountBlockedMessage)
      setStatus('error')
    }
  }, [accountBlockedMessage])

  const isPlatform = accountType === 'platform'
  const accent = isPlatform
    ? 'bg-purple-600 hover:bg-purple-700 focus:ring-purple-500'
    : 'bg-violet-600 hover:bg-violet-700 focus:ring-violet-500'

  async function handlePasswordSignIn(e: React.FormEvent) {
    e.preventDefault()
    setStatus('loading')
    setErrorMsg('')

    const fallback = setTimeout(() => {
      setStatus(prev => {
        if (prev !== 'loading') return prev
        setErrorMsg('Login is taking too long. Check your connection, or use a magic link.')
        return 'error'
      })
    }, 20_000)

    const code = isPlatform ? '__saas__' : subAccount
    const { error } = await signInWithPassword(email, code, password)

    if (error) {
      clearTimeout(fallback)
      setErrorMsg(error)
      setStatus('error')
      return
    }

    clearTimeout(fallback)
    setTimeout(() => {
      setStatus(prev => {
        if (prev !== 'loading') return prev
        setErrorMsg('Account not found in the system. Try a magic link or contact your administrator.')
        return 'error'
      })
    }, 6_000)
  }

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault()
    setStatus('loading')
    const code = isPlatform ? '__saas__' : subAccount
    const { error } = await signIn(email, code)
    if (error) { setErrorMsg(error); setStatus('error') }
    else setStatus('sent')
  }

  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault()
    setStatus('loading')
    const { error } = await sendPasswordReset(email)
    if (error) { setErrorMsg(error); setStatus('error') }
    else setStatus('sent')
  }

  function switchMode(next: Mode) {
    setMode(next); setStatus('idle'); setErrorMsg('')
    setPassword('')
  }

  // ── Success screens ──────────────────────────────────────────────────────
  if (status === 'sent' && mode === 'magic') {
    return (
      <div className="text-center space-y-3">
        <div className="text-4xl">📬</div>
        <h2 className="text-xl font-semibold text-gray-900">Check your email</h2>
        <p className="text-gray-600 text-sm">
          We sent a magic link to <strong>{email}</strong>.<br />
          Click the link to sign in instantly.
        </p>
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-xs text-amber-700 text-left">
          <strong>Not in your inbox?</strong> Check your <strong>Spam</strong> or <strong>Junk</strong> folder.
          The email comes from <em>digitracker@digi5y.com</em>.
        </div>
        <p className="text-xs text-gray-400">Link expires in 1 hour. Only one active link at a time.</p>
        <div className="flex flex-col gap-2 pt-1">
          <button
            onClick={() => { setStatus('idle'); setMode('magic') }}
            className={`text-sm hover:underline ${isPlatform ? 'text-purple-600' : 'text-violet-600'}`}
          >
            Resend magic link
          </button>
          <button onClick={() => setStatus('idle')} className="text-xs text-gray-400 hover:text-gray-600">
            ← Back to login
          </button>
        </div>
      </div>
    )
  }

  if (status === 'sent' && mode === 'forgot') {
    return (
      <div className="text-center">
        <div className="text-4xl mb-3">🔑</div>
        <h2 className="text-xl font-semibold mb-2 text-gray-900">Password reset email sent</h2>
        <p className="text-gray-500 text-sm">
          Check <strong>{email}</strong> for a reset link. The link expires in 1 hour.
        </p>
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-3 text-left">
          Important: Open the email and click the link in <strong>this same browser</strong>.
          Opening it in a different browser will not work.
        </p>
        <button
          onClick={() => switchMode('password')}
          className={`mt-5 text-sm hover:underline ${isPlatform ? 'text-purple-600' : 'text-violet-600'}`}
        >
          ← Back to login
        </button>
      </div>
    )
  }

  // ── Main form ────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {mode === 'password' && (
        <form onSubmit={handlePasswordSignIn} className="space-y-4">
          <Field label="Work email">
            <input
              type="email" required
              value={email} onChange={e => setEmail(e.target.value)}
              placeholder="you@company.com"
              className="input"
            />
          </Field>

          {!isPlatform && (
            <Field label="Sub-account code (optional)">
              <input
                type="text"
                value={subAccount} onChange={e => setSubAccount(e.target.value.toUpperCase().trim())}
                placeholder="e.g. AM333 — leave blank if unsure"
                className="input font-mono"
              />
            </Field>
          )}

          <Field label="Password">
            <div className="relative">
              <input
                type={showPass ? 'text' : 'password'} required
                value={password} onChange={e => setPassword(e.target.value)}
                placeholder="Your password"
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
          </Field>

          {status === 'error' && <p className="text-sm text-red-600">{errorMsg}</p>}

          <button
            type="submit"
            disabled={status === 'loading'}
            className={`w-full text-white rounded-lg py-3 text-sm font-semibold disabled:opacity-50 transition-colors ${accent}`}
            style={{ minHeight: '46px' }}
          >
            {status === 'loading' ? 'Signing in…' : 'Sign In'}
          </button>

          <div className="flex items-center justify-between text-xs pt-1">
            <button
              type="button"
              onClick={() => switchMode('forgot')}
              className="text-gray-500 hover:text-violet-600"
            >
              Forgot password?
            </button>
            <button
              type="button"
              onClick={() => switchMode('magic')}
              className="text-gray-500 hover:text-violet-600"
            >
              Sign in with magic link →
            </button>
          </div>
        </form>
      )}

      {mode === 'magic' && (
        <form onSubmit={handleMagicLink} className="space-y-4">
          <div className="bg-violet-50 border border-violet-200 rounded-lg px-4 py-3 text-xs text-violet-700">
            We'll email you a one-click sign-in link — no password needed.
            {isPlatform && " Use this if you haven't set a password yet."}
          </div>

          <Field label="Work email">
            <input
              type="email" required
              value={email} onChange={e => setEmail(e.target.value)}
              placeholder="you@company.com"
              className="input"
            />
          </Field>

          {!isPlatform && (
            <Field label="Sub-account code (optional)">
              <input
                type="text"
                value={subAccount} onChange={e => setSubAccount(e.target.value.toUpperCase().trim())}
                placeholder="e.g. AM333 — leave blank if unsure"
                className="input font-mono"
              />
            </Field>
          )}

          {status === 'error' && <p className="text-sm text-red-600">{errorMsg}</p>}

          <button
            type="submit"
            disabled={status === 'loading'}
            className={`w-full text-white rounded-lg py-3 text-sm font-semibold disabled:opacity-50 transition-colors ${accent}`}
            style={{ minHeight: '46px' }}
          >
            {status === 'loading' ? 'Sending…' : 'Send magic link'}
          </button>

          <div className="text-center">
            <button
              type="button"
              onClick={() => switchMode('password')}
              className="text-xs text-gray-500 hover:text-violet-600"
            >
              ← Sign in with password instead
            </button>
          </div>
        </form>
      )}

      {mode === 'forgot' && (
        <form onSubmit={handleForgotPassword} className="space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-xs text-amber-700">
            Enter your email to receive a password reset link. The link expires in 1 hour.
          </div>

          <Field label="Work email">
            <input
              type="email" required
              value={email} onChange={e => setEmail(e.target.value)}
              placeholder="you@company.com"
              className="input"
            />
          </Field>

          {status === 'error' && <p className="text-sm text-red-600">{errorMsg}</p>}

          <button
            type="submit"
            disabled={status === 'loading'}
            className={`w-full text-white rounded-lg py-3 text-sm font-semibold disabled:opacity-50 transition-colors ${accent}`}
            style={{ minHeight: '46px' }}
          >
            {status === 'loading' ? 'Sending…' : 'Send reset link'}
          </button>

          <div className="text-center">
            <button
              type="button"
              onClick={() => switchMode('password')}
              className="text-xs text-gray-500 hover:text-violet-600"
            >
              ← Back to sign in
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {children}
    </div>
  )
}
