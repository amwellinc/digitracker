import { useState } from 'react'
import { supabase } from '@/lib/supabase'

export function SecurityTab() {
  const [password, setPassword]   = useState('')
  const [confirm, setConfirm]     = useState('')
  const [showPass, setShowPass]   = useState(false)
  const [status, setStatus]       = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [errorMsg, setErrorMsg]   = useState('')

  const strong = password.length >= 8
  const hasUpper = /[A-Z]/.test(password)
  const hasNum = /[0-9]/.test(password)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) {
      setErrorMsg('Passwords do not match.')
      setStatus('error')
      return
    }
    if (!strong) {
      setErrorMsg('Password must be at least 8 characters.')
      setStatus('error')
      return
    }
    setStatus('loading'); setErrorMsg('')
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      setErrorMsg(error.message)
      setStatus('error')
      return
    }
    setStatus('done')
    setPassword(''); setConfirm('')
    setTimeout(() => setStatus('idle'), 4000)
  }

  return (
    <div className="max-w-md">
      <div className="mb-6">
        <h2 className="text-base font-semibold text-gray-900">Change Password</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Set or update your password. After saving you can sign in with email + password instead of magic links.
        </p>
      </div>

      {status === 'done' && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-green-50 border border-green-200 text-sm text-green-700 font-medium">
          ✅ Password updated successfully.
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">New password</label>
          <div className="relative">
            <input
              type={showPass ? 'text' : 'password'}
              required
              value={password}
              onChange={e => { setPassword(e.target.value); setStatus('idle'); setErrorMsg('') }}
              placeholder="At least 8 characters"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm pr-14 focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
            <button
              type="button"
              onClick={() => setShowPass(p => !p)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-600"
            >
              {showPass ? 'Hide' : 'Show'}
            </button>
          </div>

          {password.length > 0 && (
            <div className="mt-1.5 space-y-0.5 text-xs">
              <p className={strong ? 'text-green-600' : 'text-red-500'}>
                {strong ? '✓' : '✗'} At least 8 characters
              </p>
              <p className={hasUpper ? 'text-green-600' : 'text-gray-400'}>
                {hasUpper ? '✓' : '○'} Uppercase letter
              </p>
              <p className={hasNum ? 'text-green-600' : 'text-gray-400'}>
                {hasNum ? '✓' : '○'} Number
              </p>
            </div>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Confirm password</label>
          <input
            type={showPass ? 'text' : 'password'}
            required
            value={confirm}
            onChange={e => { setConfirm(e.target.value); setStatus('idle'); setErrorMsg('') }}
            placeholder="Repeat your new password"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
          />
        </div>

        {status === 'error' && (
          <p className="text-sm text-red-600">{errorMsg}</p>
        )}

        <button
          type="submit"
          disabled={status === 'loading'}
          className="bg-violet-600 hover:bg-violet-700 text-white rounded-lg px-5 py-2 text-sm font-semibold disabled:opacity-50 transition-colors"
        >
          {status === 'loading' ? 'Saving…' : 'Set Password'}
        </button>
      </form>
    </div>
  )
}
