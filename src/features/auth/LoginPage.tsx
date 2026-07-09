import { useState } from 'react'
import { useAuth } from '@/hooks/useAuth'

type Mode     = 'password' | 'magic' | 'forgot'
type AccountType = 'team' | 'platform'

export function LoginPage() {
  const { signIn, signInWithPassword, sendPasswordReset } = useAuth()

  const [accountType, setAccountType] = useState<AccountType>('team')
  const [mode, setMode]               = useState<Mode>('password')
  const [email, setEmail]             = useState('')
  const [subAccount, setSubAccount]   = useState('')
  const [password, setPassword]       = useState('')
  const [showPass, setShowPass]       = useState(false)
  const [status, setStatus]           = useState<'idle' | 'loading' | 'sent' | 'error'>('idle')
  const [errorMsg, setErrorMsg]       = useState('')

  const isPlatform = accountType === 'platform'

  async function handlePasswordSignIn(e: React.FormEvent) {
    e.preventDefault()
    setStatus('loading')
    const code = isPlatform ? '__saas__' : subAccount
    const { error } = await signInWithPassword(email, code, password)
    if (error) { setErrorMsg(error); setStatus('error') }
    // on success auth listener redirects automatically
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
      <Screen>
        <Logo />
        <div className="text-center">
          <div className="text-4xl mb-3">📬</div>
          <h2 className="text-xl font-semibold mb-2">Check your email</h2>
          <p className="text-gray-500 text-sm">
            We sent a magic link to <strong>{email}</strong>.<br />
            Click it to sign in.
          </p>
          <button onClick={() => setStatus('idle')} className="mt-5 text-sm text-violet-600 hover:underline">
            ← Back to login
          </button>
        </div>
      </Screen>
    )
  }

  if (status === 'sent' && mode === 'forgot') {
    return (
      <Screen>
        <Logo />
        <div className="text-center">
          <div className="text-4xl mb-3">🔑</div>
          <h2 className="text-xl font-semibold mb-2">Password reset email sent</h2>
          <p className="text-gray-500 text-sm">
            Check <strong>{email}</strong> for a link to set your password.<br />
            The link expires in 1 hour.
          </p>
          <button onClick={() => switchMode('password')} className="mt-5 text-sm text-violet-600 hover:underline">
            ← Back to login
          </button>
        </div>
      </Screen>
    )
  }

  // ── Main form ────────────────────────────────────────────────────────────
  return (
    <Screen>
      <Logo />

      {/* Account-type toggle */}
      <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm mb-5">
        <button
          type="button"
          onClick={() => { setAccountType('team'); setStatus('idle'); setErrorMsg('') }}
          className={`flex-1 py-2 font-medium transition-colors ${
            !isPlatform ? 'bg-violet-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'
          }`}
        >
          Team Login
        </button>
        <button
          type="button"
          onClick={() => { setAccountType('platform'); setStatus('idle'); setErrorMsg('') }}
          className={`flex-1 py-2 font-medium transition-colors ${
            isPlatform ? 'bg-purple-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'
          }`}
        >
          ⭐ Platform Admin
        </button>
      </div>

      {/* ── PASSWORD sign-in ───────────────────────────────────────────── */}
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
            <Field label="Sub-account code">
              <input
                type="text" required
                value={subAccount} onChange={e => setSubAccount(e.target.value.toUpperCase().trim())}
                placeholder="e.g. AM333"
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
            className={`w-full text-white rounded-lg py-2.5 text-sm font-semibold disabled:opacity-50 transition-colors ${
              isPlatform ? 'bg-purple-600 hover:bg-purple-700' : 'bg-violet-600 hover:bg-violet-700'
            }`}
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

      {/* ── MAGIC LINK ────────────────────────────────────────────────── */}
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
            <Field label="Sub-account code">
              <input
                type="text" required
                value={subAccount} onChange={e => setSubAccount(e.target.value.toUpperCase().trim())}
                placeholder="e.g. AM333"
                className="input font-mono"
              />
            </Field>
          )}

          {status === 'error' && <p className="text-sm text-red-600">{errorMsg}</p>}

          <button
            type="submit"
            disabled={status === 'loading'}
            className={`w-full text-white rounded-lg py-2.5 text-sm font-semibold disabled:opacity-50 transition-colors ${
              isPlatform ? 'bg-purple-600 hover:bg-purple-700' : 'bg-violet-600 hover:bg-violet-700'
            }`}
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

      {/* ── FORGOT PASSWORD ────────────────────────────────────────────── */}
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
            className="w-full bg-violet-600 hover:bg-violet-700 text-white rounded-lg py-2.5 text-sm font-semibold disabled:opacity-50 transition-colors"
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
    </Screen>
  )
}

function Screen({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="bg-white p-8 rounded-2xl shadow-lg max-w-md w-full space-y-6">
        {children}
      </div>
    </div>
  )
}

function Logo() {
  return (
    <div className="flex flex-col items-center">
      <img src="/logo.png" alt="DIGITRACKER" className="w-20 h-20 object-contain mb-2" />
      <h1 className="text-2xl font-bold tracking-tight">DIGITRACKER</h1>
      <p className="text-xs text-gray-400 mt-0.5">By DIGI5Y</p>
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
