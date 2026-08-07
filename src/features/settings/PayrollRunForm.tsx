import { useEffect, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import type { User } from '@/types'
import { todayInTz } from '@/lib/timezone'
import { useSubAccountTimezone } from '@/hooks/useSubAccountTimezone'
import { CURRENCIES, computeNetPay, fmtAmount, type PayrollRun, type PayrollSettings } from './payrollShared'

interface Props {
  users: User[]
  run: PayrollRun | null
  defaultUserId?: string
  onClose: () => void
  onSaved: () => void
}

interface LineItem { amount: number; desc: string }

const emptyLine: LineItem = { amount: 0, desc: '' }

export function PayrollRunForm({ users, run, defaultUserId, onClose, onSaved }: Props) {
  const { user } = useAuth()
  const timezone = useSubAccountTimezone()

  const [selectedUserId, setSelectedUserId] = useState(run?.user_id ?? defaultUserId ?? users[0]?.id ?? '')
  const [paymentDate, setPaymentDate] = useState(run?.payment_date ?? todayInTz(timezone))
  const [currency, setCurrency] = useState(run?.currency ?? 'SGD')
  const [gross, setGross] = useState<LineItem>(run ? { amount: run.gross_salary, desc: run.gross_salary_desc } : emptyLine)
  const [overtime, setOvertime] = useState<LineItem>(run ? { amount: run.overtime_amount, desc: run.overtime_desc } : emptyLine)
  const [incentive, setIncentive] = useState<LineItem>(run ? { amount: run.incentive_amount, desc: run.incentive_desc } : emptyLine)
  const [commission, setCommission] = useState<LineItem>(run ? { amount: run.commission_amount, desc: run.commission_desc } : emptyLine)
  const [cpf, setCpf] = useState<LineItem>(run ? { amount: run.cpf_amount, desc: run.cpf_desc } : emptyLine)
  const [insurance, setInsurance] = useState<LineItem>(run ? { amount: run.insurance_amount, desc: run.insurance_desc } : emptyLine)
  const [otherDeduction, setOtherDeduction] = useState<LineItem>(run ? { amount: run.other_deduction_amount, desc: run.other_deduction_desc } : emptyLine)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Creating a new run: prefill from that employee's Payroll Settings, if any.
  useEffect(() => {
    if (run || !selectedUserId) return
    void supabase.from('payroll_settings').select('*').eq('user_id', selectedUserId).maybeSingle()
      .then(({ data }) => {
        if (!data) return
        const s = data as PayrollSettings
        setCurrency(s.currency)
        setGross({ amount: s.gross_salary, desc: s.gross_salary_desc })
        setOvertime(s.overtime_enabled ? { amount: s.overtime_amount, desc: s.overtime_desc } : emptyLine)
        setIncentive(s.incentive_enabled ? { amount: s.incentive_amount, desc: s.incentive_desc } : emptyLine)
        setCommission(s.commission_enabled ? { amount: s.commission_amount, desc: s.commission_desc } : emptyLine)
        setCpf(s.cpf_enabled ? { amount: s.cpf_amount, desc: s.cpf_desc } : emptyLine)
        setInsurance(s.insurance_enabled ? { amount: s.insurance_amount, desc: s.insurance_desc } : emptyLine)
        setOtherDeduction(s.other_deduction_enabled ? { amount: s.other_deduction_amount, desc: s.other_deduction_desc } : emptyLine)
      })
  }, [run, selectedUserId])

  const netPay = computeNetPay({
    gross_salary: gross.amount,
    overtime_amount: overtime.amount,
    incentive_amount: incentive.amount,
    commission_amount: commission.amount,
    cpf_amount: cpf.amount,
    insurance_amount: insurance.amount,
    other_deduction_amount: otherDeduction.amount,
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!user || !selectedUserId) return
    if (gross.amount <= 0) { setError('Gross salary must be greater than zero.'); return }
    setSaving(true); setError(null)

    const payload = {
      user_id: selectedUserId,
      payment_date: paymentDate,
      currency,
      gross_salary: gross.amount, gross_salary_desc: gross.desc.trim(),
      overtime_amount: overtime.amount, overtime_desc: overtime.desc.trim(),
      incentive_amount: incentive.amount, incentive_desc: incentive.desc.trim(),
      commission_amount: commission.amount, commission_desc: commission.desc.trim(),
      cpf_amount: cpf.amount, cpf_desc: cpf.desc.trim(),
      insurance_amount: insurance.amount, insurance_desc: insurance.desc.trim(),
      other_deduction_amount: otherDeduction.amount, other_deduction_desc: otherDeduction.desc.trim(),
      net_pay: netPay,
      updated_at: new Date().toISOString(),
    }

    const { error: saveErr } = run
      ? await supabase.from('payroll_runs').update(payload).eq('id', run.id)
      : await supabase.from('payroll_runs').insert({ ...payload, created_by: user.id })

    setSaving(false)
    if (saveErr) { setError(saveErr.message); return }
    onSaved()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-gray-900">{run ? 'Edit Payroll' : 'Generate Payroll'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>

        {error && (
          <div className="mb-4 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-sm text-red-600">{error}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Employee</label>
              <select value={selectedUserId} onChange={e => setSelectedUserId(e.target.value)}
                required disabled={!!run} className="input text-sm disabled:bg-gray-50 disabled:text-gray-500">
                {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Payment Date</label>
              <input type="date" value={paymentDate} onChange={e => setPaymentDate(e.target.value)}
                required className="input text-sm" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Currency</label>
            <select value={currency} onChange={e => setCurrency(e.target.value)} className="input text-sm max-w-[8rem]">
              {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <LineRow label="Gross Salary *" item={gross} onChange={setGross} required
            placeholder="e.g. Base monthly salary" />

          <div className="pt-1">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Additions</p>
            <div className="space-y-3">
              <LineRow label="Overtime" item={overtime} onChange={setOvertime} placeholder="e.g. 10% / hour beyond 8 hrs" />
              <LineRow label="Incentive" item={incentive} onChange={setIncentive} placeholder="e.g. Performance incentive" />
              <LineRow label="Commission" item={commission} onChange={setCommission} placeholder="e.g. 2% of sales closed" />
            </div>
          </div>

          <div className="pt-1">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Deductions</p>
            <div className="space-y-3">
              <LineRow label="CPF" item={cpf} onChange={setCpf} placeholder="e.g. Employee CPF contribution" />
              <LineRow label="Insurance" item={insurance} onChange={setInsurance} placeholder="e.g. Group insurance premium" />
              <LineRow label="Other" item={otherDeduction} onChange={setOtherDeduction} placeholder="Describe this deduction" />
            </div>
          </div>

          <div className="bg-violet-50 border border-violet-200 rounded-xl px-4 py-3 flex items-center justify-between">
            <span className="text-sm font-medium text-violet-800">Net Pay</span>
            <span className="text-base font-mono font-bold text-violet-900">{fmtAmount(netPay, currency)}</span>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="text-sm font-medium text-gray-500 hover:text-gray-700 px-4 py-2">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="bg-violet-600 hover:bg-violet-700 text-white rounded-lg px-5 py-2 text-sm font-semibold disabled:opacity-50 transition-colors">
              {saving ? 'Saving…' : run ? 'Save Changes' : 'Generate Payroll'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function LineRow({ label, item, onChange, placeholder, required }: {
  label: string
  item: LineItem
  onChange: (v: LineItem) => void
  placeholder: string
  required?: boolean
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-start">
      <div>
        <label className="block text-[11px] font-medium text-gray-500 mb-1">{label}</label>
        <input type="number" step="0.01" min="0" value={item.amount}
          onChange={e => onChange({ ...item, amount: parseFloat(e.target.value) || 0 })}
          required={required}
          className="input text-sm font-mono" />
      </div>
      <div className="col-span-2">
        <label className="block text-[11px] font-medium text-gray-500 mb-1 opacity-0 select-none">desc</label>
        <input value={item.desc} onChange={e => onChange({ ...item, desc: e.target.value })}
          placeholder={placeholder} className="input text-sm" />
      </div>
    </div>
  )
}
