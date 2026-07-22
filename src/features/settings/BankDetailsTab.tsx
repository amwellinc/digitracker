import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import type { User } from '@/types'

interface BankDetails {
  id?: string
  user_id?: string
  bank_name: string
  account_name: string
  account_number: string
  bank_location: string
  ifsc_iban_code: string
  swift_code: string
}

const empty = (): BankDetails => ({
  bank_name: '', account_name: '', account_number: '',
  bank_location: '', ifsc_iban_code: '', swift_code: '',
})

const FIELD_LABELS: { key: keyof BankDetails; label: string; mono?: boolean }[] = [
  { key: 'bank_name', label: 'Bank Name' },
  { key: 'account_name', label: 'Account Name' },
  { key: 'account_number', label: 'Account Number', mono: true },
  { key: 'bank_location', label: 'Bank Location / Branch' },
  { key: 'ifsc_iban_code', label: 'IFSC / IBAN Code', mono: true },
  { key: 'swift_code', label: 'SWIFT / BIC Code', mono: true },
]

export function BankDetailsTab() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'Admin' || user?.role === 'Super-Admin'

  const [members, setMembers] = useState<User[]>([])
  const [selectedUserId, setSelectedUserId] = useState('')
  const [form, setForm]     = useState<BankDetails>(empty())
  const [hasRecord, setHasRecord] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [msg, setMsg]         = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const viewingSelf = !selectedUserId || selectedUserId === user?.id

  // Admin: load the team so they can view (read-only) anyone's bank details
  useEffect(() => {
    if (!user || !isAdmin) return
    void supabase
      .from('users')
      .select('*')
      .eq('sub_account', user.sub_account)
      .order('name')
      .then(({ data }) => setMembers((data ?? []) as User[]))
  }, [user, isAdmin])

  const loadDetails = useCallback(async (targetId: string) => {
    setLoading(true)
    const { data } = await supabase
      .from('user_bank_details')
      .select('*')
      .eq('user_id', targetId)
      .maybeSingle()
    setForm(data ? (data as BankDetails) : empty())
    setHasRecord(!!data)
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!user) return
    void loadDetails(selectedUserId || user.id)
  }, [user, selectedUserId, loadDetails])

  function patch(key: keyof BankDetails, val: string) {
    setForm(f => ({ ...f, [key]: val }))
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!user) return
    setSaving(true); setMsg(null)

    const payload = {
      user_id: user.id,
      bank_name: form.bank_name.trim(),
      account_name: form.account_name.trim(),
      account_number: form.account_number.trim(),
      bank_location: form.bank_location.trim(),
      ifsc_iban_code: form.ifsc_iban_code.trim(),
      swift_code: form.swift_code.trim(),
      updated_at: new Date().toISOString(),
    }

    const { error } = form.id
      ? await supabase.from('user_bank_details').update(payload).eq('id', form.id)
      : await supabase.from('user_bank_details').insert(payload).select('id').single().then(async r => {
          if (r.data) setForm(f => ({ ...f, id: r.data.id }))
          return r
        })

    setSaving(false)
    setMsg(error
      ? { type: 'error', text: error.message }
      : { type: 'success', text: 'Bank details saved.' }
    )
    setTimeout(() => setMsg(null), 3000)
  }

  if (loading) return <div className="text-sm text-gray-400 py-8 text-center">Loading…</div>

  return (
    <div className="max-w-lg">
      <div className="mb-5 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Bank Details</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {isAdmin
              ? 'Banking information for payroll processing. Visible to Admins and the employee only.'
              : 'Your banking information for payroll processing. Visible to you and your Admin only.'}
          </p>
        </div>
        {isAdmin && members.length > 0 && (
          <select
            value={selectedUserId || user?.id || ''}
            onChange={e => setSelectedUserId(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-violet-500"
          >
            {members.map(m => (
              <option key={m.id} value={m.id}>{m.id === user?.id ? `${m.name} (you)` : m.name}</option>
            ))}
          </select>
        )}
      </div>

      {msg && (
        <div className={`mb-4 px-4 py-3 rounded-lg text-sm font-medium ${
          msg.type === 'success' ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'
        }`}>
          {msg.text}
        </div>
      )}

      {viewingSelf ? (
        <form onSubmit={handleSave} className="space-y-4">
          {FIELD_LABELS.map(({ key, label, mono }) => (
            <Row key={key} label={label}>
              <input
                value={form[key] as string}
                onChange={e => patch(key, e.target.value)}
                placeholder={PLACEHOLDERS[key]}
                className={`input ${mono ? 'font-mono' : ''}`}
              />
            </Row>
          ))}

          <button
            type="submit"
            disabled={saving}
            className="bg-violet-600 hover:bg-violet-700 text-white rounded-lg px-5 py-2 text-sm font-semibold disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving…' : 'Save Bank Details'}
          </button>
        </form>
      ) : !hasRecord ? (
        <div className="bg-white border border-gray-200 rounded-xl py-10 text-center text-sm text-gray-400">
          No bank details provided yet.
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-50">
          {FIELD_LABELS.map(({ key, label, mono }) => (
            <div key={key} className="flex items-center justify-between px-4 py-3">
              <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">{label}</span>
              <span className={`text-sm text-gray-800 ${mono ? 'font-mono' : ''}`}>{(form[key] as string) || '—'}</span>
            </div>
          ))}
          <p className="px-4 py-3 text-xs text-gray-400">Read-only — only the employee can edit their own bank details.</p>
        </div>
      )}
    </div>
  )
}

const PLACEHOLDERS: Record<keyof BankDetails, string> = {
  bank_name: 'e.g. DBS Bank',
  account_name: 'Name as per bank account',
  account_number: 'e.g. 0123456789',
  bank_location: 'e.g. Singapore, Orchard Branch',
  ifsc_iban_code: 'e.g. SBIN0001234 or GB29NWBK...',
  swift_code: 'e.g. DBSSSGSG',
  id: '',
  user_id: '',
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {children}
    </div>
  )
}
