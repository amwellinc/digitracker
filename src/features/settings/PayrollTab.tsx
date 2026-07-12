import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import type { User } from '@/types'

const CURRENCIES = ['SGD', 'MYR', 'PHP', 'USD', 'GBP', 'AUD', 'INR', 'AED', 'IDR', 'THB', 'VND', 'CNY', 'JPY']
const PAYMENT_MODES = ['Bank Transfer', 'Cash', 'Cheque', 'PayNow', 'FAST', 'NEFT', 'RTGS', 'Wire Transfer', 'Crypto', 'Other']

interface PayrollEntry {
  id: string
  user_id: string
  payment_date: string
  description: string
  amount: number
  currency: string
  payment_mode: string
  created_at: string
  created_by: string | null
  user?: { name: string; email: string }
  creator?: { name: string }
}

interface EntryForm {
  user_id: string
  payment_date: string
  description: string
  amount: string
  currency: string
  payment_mode: string
}

const emptyForm = (userId: string): EntryForm => ({
  user_id: userId,
  payment_date: new Date().toISOString().split('T')[0],
  description: '',
  amount: '',
  currency: 'SGD',
  payment_mode: 'Bank Transfer',
})

export function PayrollTab() {
  const { user } = useAuth()
  const isManager = user?.role === 'Admin' || user?.role === 'Manager' || user?.role === 'Super-Admin'

  const [entries, setEntries]   = useState<PayrollEntry[]>([])
  const [users, setUsers]       = useState<User[]>([])
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [form, setForm]         = useState<EntryForm>(emptyForm(user?.id ?? ''))
  const [msg, setMsg]           = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [filterUser, setFilterUser] = useState<string>('all')

  const fetchEntries = useCallback(async () => {
    if (!user) return
    setLoading(true)
    const q = supabase
      .from('payroll_entries')
      .select('*, user:users!payroll_entries_user_id_fkey(name,email), creator:users!payroll_entries_created_by_fkey(name)')
      .order('payment_date', { ascending: false })

    if (!isManager) q.eq('user_id', user.id)

    const { data } = await q
    setEntries((data as PayrollEntry[]) ?? [])
    setLoading(false)
  }, [user, isManager])

  useEffect(() => {
    void fetchEntries()
    if (isManager && user) {
      const q = supabase.from('users').select('id, name, email, role')
      const scoped = user.role === 'Manager'
        ? q.eq('manager_id', user.id)
        : q.eq('sub_account', user.sub_account)
      void scoped.order('name').then(({ data }) => setUsers((data as User[]) ?? []))
    }
  }, [fetchEntries, isManager, user])

  function patch(key: keyof EntryForm, val: string) {
    setForm(f => ({ ...f, [key]: val }))
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!user) return
    const amt = parseFloat(form.amount)
    if (isNaN(amt) || amt <= 0) {
      setMsg({ type: 'error', text: 'Enter a valid amount.' }); return
    }
    setSaving(true); setMsg(null)
    const { error } = await supabase.from('payroll_entries').insert({
      user_id: form.user_id,
      payment_date: form.payment_date,
      description: form.description.trim(),
      amount: amt,
      currency: form.currency,
      payment_mode: form.payment_mode,
      created_by: user.id,
    })
    setSaving(false)
    if (error) { setMsg({ type: 'error', text: error.message }); return }
    setForm(emptyForm(user.id))
    setMsg({ type: 'success', text: 'Payroll entry added.' })
    void fetchEntries()
    setTimeout(() => setMsg(null), 3000)
  }

  async function handleDelete(id: string) {
    setDeleting(id)
    await supabase.from('payroll_entries').delete().eq('id', id)
    setDeleting(null)
    void fetchEntries()
  }

  const visible = filterUser === 'all'
    ? entries
    : entries.filter(e => e.user_id === filterUser)

  const totalByCurrency = visible.reduce<Record<string, number>>((acc, e) => {
    acc[e.currency] = (acc[e.currency] ?? 0) + Number(e.amount)
    return acc
  }, {})

  function fmtAmount(amount: number, currency: string) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount)
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-5">
        <h2 className="text-base font-semibold text-gray-900">Payroll</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          {isManager ? 'Add payroll entries and view payment history for your team.' : 'Your payroll payment history.'}
        </p>
      </div>

      {msg && (
        <div className={`mb-4 px-4 py-3 rounded-lg text-sm font-medium ${
          msg.type === 'success' ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'
        }`}>
          {msg.text}
        </div>
      )}

      {/* Add Entry Form — managers only */}
      {isManager && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6">
          <h3 className="text-sm font-semibold text-gray-800 mb-4">Add Payroll Entry</h3>
          <form onSubmit={handleAdd} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Employee</label>
                <select value={form.user_id} onChange={e => patch('user_id', e.target.value)}
                  required className="input text-sm">
                  <option value="">Select employee…</option>
                  {users.map(u => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Payment Date</label>
                <input type="date" value={form.payment_date} onChange={e => patch('payment_date', e.target.value)}
                  required className="input text-sm" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
              <input value={form.description} onChange={e => patch('description', e.target.value)}
                required placeholder="e.g. July 2026 Salary, Performance Bonus…" className="input text-sm" />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Currency</label>
                <select value={form.currency} onChange={e => patch('currency', e.target.value)}
                  className="input text-sm">
                  {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Amount</label>
                <input type="number" step="0.01" min="0.01" value={form.amount}
                  onChange={e => patch('amount', e.target.value)}
                  required placeholder="0.00" className="input text-sm font-mono" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Payment Mode</label>
                <select value={form.payment_mode} onChange={e => patch('payment_mode', e.target.value)}
                  className="input text-sm">
                  {PAYMENT_MODES.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            </div>

            <button type="submit" disabled={saving}
              className="bg-violet-600 hover:bg-violet-700 text-white rounded-lg px-5 py-2 text-sm font-semibold disabled:opacity-50 transition-colors">
              {saving ? 'Adding…' : '+ Add Entry'}
            </button>
          </form>
        </div>
      )}

      {/* Transactions List */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-800">
            Payment History {!loading && `(${visible.length})`}
          </h3>
          <div className="flex items-center gap-3">
            {/* Totals */}
            {Object.entries(totalByCurrency).map(([cur, tot]) => (
              <span key={cur} className="text-xs font-mono bg-violet-50 text-violet-700 px-2 py-0.5 rounded">
                {fmtAmount(tot, cur)}
              </span>
            ))}
            {isManager && users.length > 0 && (
              <select value={filterUser} onChange={e => setFilterUser(e.target.value)}
                className="text-xs border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-violet-400">
                <option value="all">All employees</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            )}
          </div>
        </div>

        {loading ? (
          <div className="py-12 text-center text-sm text-gray-400">Loading…</div>
        ) : visible.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">No payroll entries yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 whitespace-nowrap">Date</th>
                  {isManager && <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 whitespace-nowrap">Employee</th>}
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500">Description</th>
                  <th className="text-right px-4 py-2.5 text-xs font-medium text-gray-500 whitespace-nowrap">Amount</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 whitespace-nowrap">Mode</th>
                  {isManager && <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 whitespace-nowrap">Added by</th>}
                  {isManager && <th className="px-4 py-2.5" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {visible.map(e => (
                  <tr key={e.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap font-mono text-xs">
                      {new Date(e.payment_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </td>
                    {isManager && (
                      <td className="px-4 py-3 whitespace-nowrap">
                        <p className="text-gray-800 font-medium text-xs">{e.user?.name ?? '—'}</p>
                        <p className="text-gray-400 text-xs">{e.user?.email}</p>
                      </td>
                    )}
                    <td className="px-4 py-3 text-gray-700">{e.description}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap font-mono font-semibold text-gray-900">
                      {fmtAmount(e.amount, e.currency)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="inline-block text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                        {e.payment_mode}
                      </span>
                    </td>
                    {isManager && (
                      <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
                        {e.creator?.name ?? '—'}
                      </td>
                    )}
                    {isManager && (
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => void handleDelete(e.id)}
                          disabled={deleting === e.id}
                          className="text-xs text-red-400 hover:text-red-600 disabled:opacity-40"
                        >
                          {deleting === e.id ? '…' : 'Delete'}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
