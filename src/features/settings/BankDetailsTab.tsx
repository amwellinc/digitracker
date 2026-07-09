import { useState, useEffect } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'

interface BankDetails {
  id?: string
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

export function BankDetailsTab() {
  const { user } = useAuth()
  const [form, setForm]     = useState<BankDetails>(empty())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [msg, setMsg]         = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    if (!user) return
    void supabase
      .from('user_bank_details')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setForm(data as BankDetails)
        setLoading(false)
      })
  }, [user])

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
      <div className="mb-5">
        <h2 className="text-base font-semibold text-gray-900">Bank Details</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Your banking information for payroll processing. Visible to your Manager and Admin.
        </p>
      </div>

      {msg && (
        <div className={`mb-4 px-4 py-3 rounded-lg text-sm font-medium ${
          msg.type === 'success' ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'
        }`}>
          {msg.text}
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-4">
        <Row label="Bank Name">
          <input value={form.bank_name} onChange={e => patch('bank_name', e.target.value)}
            placeholder="e.g. DBS Bank" className="input" />
        </Row>

        <Row label="Account Name">
          <input value={form.account_name} onChange={e => patch('account_name', e.target.value)}
            placeholder="Name as per bank account" className="input" />
        </Row>

        <Row label="Account Number">
          <input value={form.account_number} onChange={e => patch('account_number', e.target.value)}
            placeholder="e.g. 0123456789" className="input font-mono" />
        </Row>

        <Row label="Bank Location / Branch">
          <input value={form.bank_location} onChange={e => patch('bank_location', e.target.value)}
            placeholder="e.g. Singapore, Orchard Branch" className="input" />
        </Row>

        <Row label="IFSC / IBAN Code">
          <input value={form.ifsc_iban_code} onChange={e => patch('ifsc_iban_code', e.target.value)}
            placeholder="e.g. SBIN0001234 or GB29NWBK..." className="input font-mono" />
        </Row>

        <Row label="SWIFT / BIC Code">
          <input value={form.swift_code} onChange={e => patch('swift_code', e.target.value)}
            placeholder="e.g. DBSSSGSG" className="input font-mono" />
        </Row>

        <button
          type="submit"
          disabled={saving}
          className="bg-violet-600 hover:bg-violet-700 text-white rounded-lg px-5 py-2 text-sm font-semibold disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving…' : 'Save Bank Details'}
        </button>
      </form>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {children}
    </div>
  )
}
