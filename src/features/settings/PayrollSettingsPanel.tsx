import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import type { User } from '@/types'
import { CURRENCIES, computeNetPay, emptyPayrollSettings, fmtAmount, type PayrollSettings } from './payrollShared'

interface Props {
  isManager: boolean
  users: User[]
}

type FormState = Omit<PayrollSettings, 'id' | 'created_at' | 'updated_at'>

export function PayrollSettingsPanel({ isManager, users }: Props) {
  const { user } = useAuth()
  const [selectedUserId, setSelectedUserId] = useState('')
  const [settingsId, setSettingsId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(emptyPayrollSettings(user?.id ?? ''))
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const targetId = isManager ? (selectedUserId || user?.id || '') : (user?.id ?? '')
  const readOnly = !isManager

  const load = useCallback(async (uid: string) => {
    if (!uid) return
    setLoading(true)
    const { data } = await supabase.from('payroll_settings').select('*').eq('user_id', uid).maybeSingle()
    if (data) {
      const row = data as PayrollSettings
      setSettingsId(row.id)
      setForm(row)
    } else {
      setSettingsId(null)
      setForm(emptyPayrollSettings(uid))
    }
    setLoading(false)
  }, [])

  useEffect(() => { void load(targetId) }, [targetId, load])

  function patch<K extends keyof FormState>(key: K, val: FormState[K]) {
    setForm(f => ({ ...f, [key]: val }))
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!user || !targetId) return
    setSaving(true); setMsg(null)
    const payload = { ...form, user_id: targetId, updated_by: user.id, updated_at: new Date().toISOString() }
    const { error } = settingsId
      ? await supabase.from('payroll_settings').update(payload).eq('id', settingsId)
      : await supabase.from('payroll_settings').insert(payload)
    setSaving(false)
    if (error) { setMsg({ type: 'error', text: error.message }); return }
    setMsg({ type: 'success', text: 'Payroll settings saved.' })
    void load(targetId)
    setTimeout(() => setMsg(null), 3000)
  }

  const netPay = computeNetPay(form)

  if (loading) return <div className="py-12 text-center text-sm text-gray-400">Loading…</div>

  return (
    <div>
      {isManager && users.length > 0 && (
        <div className="mb-5 max-w-xs">
          <label className="block text-xs font-medium text-gray-600 mb-1">Employee</label>
          <select value={selectedUserId || user?.id || ''} onChange={e => setSelectedUserId(e.target.value)}
            className="input text-sm">
            {users.map(u => (
              <option key={u.id} value={u.id}>{u.id === user?.id ? `${u.name} (you)` : u.name}</option>
            ))}
          </select>
        </div>
      )}

      {msg && (
        <div className={`mb-4 px-4 py-3 rounded-lg text-sm font-medium ${
          msg.type === 'success' ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'
        }`}>
          {msg.text}
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-5">
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-gray-800 mb-4">Gross Salary</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Currency</label>
              <select disabled={readOnly} value={form.currency} onChange={e => patch('currency', e.target.value)}
                className="input text-sm disabled:bg-gray-50 disabled:text-gray-500">
                {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Amount</label>
              <input disabled={readOnly} type="number" step="0.01" min="0" value={form.gross_salary}
                onChange={e => patch('gross_salary', parseFloat(e.target.value) || 0)}
                className="input text-sm font-mono disabled:bg-gray-50 disabled:text-gray-500" />
            </div>
          </div>
          <div className="mt-3">
            <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
            <input disabled={readOnly} value={form.gross_salary_desc}
              onChange={e => patch('gross_salary_desc', e.target.value)}
              placeholder="e.g. Base monthly salary"
              className="input text-sm disabled:bg-gray-50 disabled:text-gray-500" />
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-gray-800 mb-1">Additions</h3>
          <p className="text-xs text-gray-400 mb-4">Toggle on any that apply to this employee.</p>
          <div className="divide-y divide-gray-100">
            <ToggleRow
              label="Overtime" readOnly={readOnly} currency={form.currency}
              enabled={form.overtime_enabled} amount={form.overtime_amount} desc={form.overtime_desc}
              descPlaceholder="e.g. 10% / hour beyond 8 hrs"
              onToggle={v => patch('overtime_enabled', v)}
              onAmount={v => patch('overtime_amount', v)}
              onDesc={v => patch('overtime_desc', v)}
            />
            <ToggleRow
              label="Incentive" readOnly={readOnly} currency={form.currency}
              enabled={form.incentive_enabled} amount={form.incentive_amount} desc={form.incentive_desc}
              descPlaceholder="e.g. Performance incentive"
              onToggle={v => patch('incentive_enabled', v)}
              onAmount={v => patch('incentive_amount', v)}
              onDesc={v => patch('incentive_desc', v)}
            />
            <ToggleRow
              label="Commission" readOnly={readOnly} currency={form.currency}
              enabled={form.commission_enabled} amount={form.commission_amount} desc={form.commission_desc}
              descPlaceholder="e.g. 2% of sales closed"
              onToggle={v => patch('commission_enabled', v)}
              onAmount={v => patch('commission_amount', v)}
              onDesc={v => patch('commission_desc', v)}
            />
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-gray-800 mb-1">Deductions</h3>
          <p className="text-xs text-gray-400 mb-4">Amounts here are subtracted from gross salary.</p>
          <div className="divide-y divide-gray-100">
            <ToggleRow
              label="CPF" readOnly={readOnly} currency={form.currency}
              enabled={form.cpf_enabled} amount={form.cpf_amount} desc={form.cpf_desc}
              descPlaceholder="e.g. Employee CPF contribution"
              onToggle={v => patch('cpf_enabled', v)}
              onAmount={v => patch('cpf_amount', v)}
              onDesc={v => patch('cpf_desc', v)}
            />
            <ToggleRow
              label="Insurance" readOnly={readOnly} currency={form.currency}
              enabled={form.insurance_enabled} amount={form.insurance_amount} desc={form.insurance_desc}
              descPlaceholder="e.g. Group insurance premium"
              onToggle={v => patch('insurance_enabled', v)}
              onAmount={v => patch('insurance_amount', v)}
              onDesc={v => patch('insurance_desc', v)}
            />
            <ToggleRow
              label="Other" readOnly={readOnly} currency={form.currency}
              enabled={form.other_deduction_enabled} amount={form.other_deduction_amount} desc={form.other_deduction_desc}
              descPlaceholder="Describe this deduction, e.g. Advance repayment"
              descIsLabel
              onToggle={v => patch('other_deduction_enabled', v)}
              onAmount={v => patch('other_deduction_amount', v)}
              onDesc={v => patch('other_deduction_desc', v)}
            />
          </div>
        </div>

        <div className="bg-violet-50 border border-violet-200 rounded-xl px-5 py-4 flex items-center justify-between">
          <span className="text-sm font-medium text-violet-800">Estimated Net Pay</span>
          <span className="text-lg font-mono font-bold text-violet-900">{fmtAmount(netPay, form.currency)}</span>
        </div>

        {isManager && (
          <button type="submit" disabled={saving}
            className="bg-violet-600 hover:bg-violet-700 text-white rounded-lg px-5 py-2 text-sm font-semibold disabled:opacity-50 transition-colors">
            {saving ? 'Saving…' : 'Save Payroll Settings'}
          </button>
        )}
      </form>
    </div>
  )
}

interface ToggleRowProps {
  label: string
  readOnly: boolean
  currency: string
  enabled: boolean
  amount: number
  desc: string
  descPlaceholder: string
  descIsLabel?: boolean
  onToggle: (v: boolean) => void
  onAmount: (v: number) => void
  onDesc: (v: string) => void
}

function ToggleRow({ label, readOnly, currency, enabled, amount, desc, descPlaceholder, descIsLabel, onToggle, onAmount, onDesc }: ToggleRowProps) {
  if (readOnly && !enabled) return null

  return (
    <div className="py-4 first:pt-0 last:pb-0">
      <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
        <input type="checkbox" checked={enabled} disabled={readOnly}
          onChange={e => onToggle(e.target.checked)}
          className="rounded border-gray-300 text-violet-600 focus:ring-violet-500 disabled:opacity-60" />
        {label}
      </label>

      {enabled && (
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-3 pl-6">
          <div>
            <label className="block text-[11px] font-medium text-gray-500 mb-1">Amount ({currency})</label>
            <input disabled={readOnly} type="number" step="0.01" min="0" value={amount}
              onChange={e => onAmount(parseFloat(e.target.value) || 0)}
              className="input text-sm font-mono disabled:bg-gray-50 disabled:text-gray-500" />
          </div>
          <div className="col-span-2">
            <label className="block text-[11px] font-medium text-gray-500 mb-1">
              {descIsLabel ? 'Description (required)' : 'Short description'}
            </label>
            <input disabled={readOnly} value={desc} onChange={e => onDesc(e.target.value)}
              placeholder={descPlaceholder} required={descIsLabel}
              className="input text-sm disabled:bg-gray-50 disabled:text-gray-500" />
          </div>
        </div>
      )}
    </div>
  )
}
