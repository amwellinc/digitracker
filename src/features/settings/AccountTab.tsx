import { useState, useEffect } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import { TIMEZONE_OPTIONS, DEFAULT_TIMEZONE } from '@/lib/timezone'
import { invalidateTimezoneCache } from '@/hooks/useSubAccountTimezone'

function InfoRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-1 py-3 border-b border-gray-100 last:border-0">
      <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</span>
      <span className={`text-sm text-gray-900 ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  )
}

export function AccountTab() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'Admin' || user?.role === 'Super-Admin'

  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    if (!user?.sub_account || !isAdmin) return
    void supabase
      .from('sub_accounts')
      .select('timezone')
      .eq('code', user.sub_account)
      .single()
      .then(({ data }) => {
        if (data) setTimezone((data as { timezone: string }).timezone ?? DEFAULT_TIMEZONE)
      })
  }, [user?.sub_account, isAdmin])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!user?.sub_account) return
    setSaving(true)
    const { error } = await supabase
      .from('sub_accounts')
      .update({ timezone })
      .eq('code', user.sub_account)
    setSaving(false)
    if (error) {
      setMsg({ type: 'error', text: error.message })
    } else {
      invalidateTimezoneCache(user.sub_account)
      setMsg({ type: 'success', text: 'Work timezone saved. Calendars will now follow this timezone.' })
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      {/* Read-only workspace info */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Account</h2>
        <p className="text-sm text-gray-500 mb-6">Your workspace configuration and identifiers.</p>

        <InfoRow label="Sub-account Code" value={user?.sub_account ?? '—'} />
        <InfoRow label="Role"             value={user?.role ?? '—'} />
        <InfoRow label="Email"            value={user?.email ?? '—'} />
        <InfoRow label="User ID"          value={user?.id ?? '—'} mono />
        <InfoRow label="Supabase Project" value="mllrjejqyddgaxxtjsqf" mono />
        <InfoRow label="Application URL"  value="https://digitracker.digi5y.co" mono />
        <InfoRow
          label="Member since"
          value={
            user?.created_at
              ? new Date(user.created_at).toLocaleDateString('en-SG', {
                  year: 'numeric', month: 'long', day: 'numeric',
                })
              : '—'
          }
        />
      </div>

      {/* Timezone setting — Admin / Super-Admin only */}
      {isAdmin && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Work Calendar Timezone</h2>
          <p className="text-sm text-gray-500 mb-5">
            Sets the timezone used by all calendars in your workspace. "Today" and date highlights
            will follow this timezone for every user in your sub-account.
          </p>
          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Timezone</label>
              <select
                value={timezone}
                onChange={e => setTimezone(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
              >
                {TIMEZONE_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <p className="text-xs text-gray-400 mt-1">
                Current timezone: <span className="font-mono">{timezone}</span>
              </p>
            </div>

            {msg && (
              <p className={`text-sm ${msg.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
                {msg.text}
              </p>
            )}

            <button
              type="submit"
              disabled={saving}
              className="bg-violet-600 text-white rounded-lg px-5 py-2 text-sm font-medium hover:bg-violet-700 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving…' : 'Save Timezone'}
            </button>
          </form>
        </div>
      )}

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
        <p className="text-sm text-amber-800 font-medium">⚠ Sub-account code is your company's unique identifier.</p>
        <p className="text-xs text-amber-700 mt-1">
          Share it with your team so they can log in. It cannot be changed after setup.
        </p>
      </div>
    </div>
  )
}
