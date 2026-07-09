import { useState } from 'react'
import { useAuth } from '@/hooks/useAuth'

export function LoginPage() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [subAccount, setSubAccount] = useState('')
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [status, setStatus] = useState<'idle' | 'loading' | 'sent' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setStatus('loading')
    const code = isSuperAdmin ? '__saas__' : subAccount
    const { error } = await signIn(email, code)
    if (error) {
      setErrorMsg(error)
      setStatus('error')
    } else {
      setStatus('sent')
    }
  }

  if (status === 'sent') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white p-8 rounded-xl shadow text-center max-w-md w-full">
          <img src="/logo.png" alt="DIGITRACKER" className="w-16 h-16 object-contain mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">Check your email</h2>
          <p className="text-gray-500 text-sm">
            We sent a magic link to <strong>{email}</strong>. Click it to sign in.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white p-8 rounded-xl shadow max-w-md w-full">
        <div className="flex flex-col items-center mb-8">
          <img src="/logo.png" alt="DIGITRACKER" className="w-24 h-24 object-contain mb-2" />
          <h1 className="text-2xl font-bold tracking-tight">DIGITRACKER</h1>
          <p className="text-xs text-gray-400 mt-0.5">By DIGI5Y</p>
        </div>

        {/* Super Admin toggle */}
        <div className="flex rounded-lg border border-gray-200 mb-5 overflow-hidden text-sm">
          <button
            type="button"
            onClick={() => setIsSuperAdmin(false)}
            className={`flex-1 py-2 font-medium transition-colors ${!isSuperAdmin ? 'bg-violet-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}
          >
            Team Login
          </button>
          <button
            type="button"
            onClick={() => setIsSuperAdmin(true)}
            className={`flex-1 py-2 font-medium transition-colors ${isSuperAdmin ? 'bg-purple-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}
          >
            ⭐ Platform Admin
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Work email
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@company.com"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          </div>

          {!isSuperAdmin && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Sub-account code
              </label>
              <input
                type="text"
                required
                value={subAccount}
                onChange={e => setSubAccount(e.target.value.toUpperCase().trim())}
                placeholder="e.g. AM333"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 font-mono"
              />
            </div>
          )}

          {isSuperAdmin && (
            <div className="bg-purple-50 border border-purple-200 rounded-lg px-4 py-3 text-xs text-purple-700">
              Platform Admin access — magic link will be sent to your email.
            </div>
          )}

          {status === 'error' && (
            <p className="text-sm text-red-600">{errorMsg}</p>
          )}

          <button
            type="submit"
            disabled={status === 'loading'}
            className={`w-full text-white rounded-lg py-2 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${
              isSuperAdmin ? 'bg-purple-600 hover:bg-purple-700' : 'bg-violet-600 hover:bg-violet-700'
            }`}
          >
            {status === 'loading' ? 'Checking...' : 'Send magic link'}
          </button>
        </form>
      </div>
    </div>
  )
}
