import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import type { Subscription } from '@/types'

const PLAN_MRR: Record<string, number> = { free: 0, basic: 19.9, business: 39.9, professional: 99.9 }

const PLAN_COLORS: Record<string, string> = {
  free:         'bg-gray-100 text-gray-600',
  basic:        'bg-blue-100 text-blue-700',
  business:     'bg-violet-100 text-violet-700',
  professional: 'bg-amber-100 text-amber-700',
}

const STATUS_COLORS: Record<string, string> = {
  active:    'bg-green-100 text-green-700',
  trialing:  'bg-amber-100 text-amber-700',
  cancelled: 'bg-red-100 text-red-700',
}

interface EditForm {
  plan: Subscription['plan']
  seats: string
  status: Subscription['status']
  billing_cycle: 'monthly' | 'annual'
  billing_date: string
  company_name: string
  notes: string
}

export function PlatformSubscriptionsTab() {
  const [subs, setSubs] = useState<Subscription[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterPlan, setFilterPlan] = useState('all')
  const [filterStatus, setFilterStatus] = useState('all')
  const [editSub, setEditSub] = useState<Subscription | null>(null)
  const [editForm, setEditForm] = useState<EditForm | null>(null)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('subscriptions')
      .select('*')
      .order('created_at', { ascending: false })
    setSubs((data ?? []) as Subscription[])
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  function openEdit(s: Subscription) {
    setEditForm({
      plan: s.plan,
      seats: String(s.seats),
      status: s.status,
      billing_cycle: s.billing_cycle ?? 'monthly',
      billing_date: s.billing_date ?? '',
      company_name: s.company_name ?? '',
      notes: s.notes ?? '',
    })
    setEditSub(s)
    setMsg(null)
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editSub || !editForm) return
    setSaving(true)
    setMsg(null)

    const { error } = await supabase
      .from('subscriptions')
      .update({
        plan: editForm.plan,
        seats: Number(editForm.seats),
        status: editForm.status,
        billing_cycle: editForm.billing_cycle,
        billing_date: editForm.billing_date || null,
        company_name: editForm.company_name.trim() || null,
        notes: editForm.notes.trim() || null,
      })
      .eq('id', editSub.id)

    if (!error) {
      await supabase
        .from('sub_accounts')
        .update({ plan: editForm.plan, seats: Number(editForm.seats), status: editForm.status })
        .eq('code', editSub.sub_account)
    }

    setSaving(false)
    if (error) { setMsg({ type: 'error', text: error.message }); return }
    void load()
    setEditSub(null)
    setEditForm(null)
  }

  const filtered = subs
    .filter(s => filterPlan === 'all' || s.plan === filterPlan)
    .filter(s => filterStatus === 'all' || s.status === filterStatus)
    .filter(s =>
      s.sub_account.toLowerCase().includes(search.toLowerCase()) ||
      (s.company_name ?? '').toLowerCase().includes(search.toLowerCase())
    )

  const totalMRR = subs
    .filter(s => s.status === 'active')
    .reduce((acc, s) => acc + PLAN_MRR[s.plan], 0)
  const activeCount = subs.filter(s => s.status === 'active').length
  const trialingCount = subs.filter(s => s.status === 'trialing').length

  return (
    <div>
      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <SummaryCard label="Monthly Revenue" value={`$${totalMRR.toFixed(2)}`} sub="from active plans" color="text-green-700" />
        <SummaryCard label="Active Accounts" value={String(activeCount)} sub={`${subs.length} total`} color="text-violet-700" />
        <SummaryCard label="On Trial" value={String(trialingCount)} sub="need conversion" color="text-amber-700" />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <input
          placeholder="Search by code or company…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 w-56"
        />
        <select
          value={filterPlan}
          onChange={e => setFilterPlan(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
        >
          <option value="all">All Plans</option>
          <option value="free">Free</option>
          <option value="basic">Basic</option>
          <option value="business">Business</option>
          <option value="professional">Professional</option>
        </select>
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
        >
          <option value="all">All Statuses</option>
          <option value="active">Active</option>
          <option value="trialing">Trialing</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-40 text-sm text-gray-400">Loading…</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Sub-Account</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Company</th>
                <th className="text-center px-4 py-3 font-medium text-gray-600">Plan</th>
                <th className="text-center px-4 py-3 font-medium text-gray-600">Seats</th>
                <th className="text-center px-4 py-3 font-medium text-gray-600">Status</th>
                <th className="text-center px-4 py-3 font-medium text-gray-600">Cycle</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Next Billing</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">MRR</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.length === 0 && (
                <tr><td colSpan={9} className="text-center py-10 text-gray-400">No subscriptions found.</td></tr>
              )}
              {filtered.map(s => (
                <tr key={s.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <span className="font-mono font-bold text-gray-800 bg-gray-100 px-2 py-0.5 rounded">{s.sub_account}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-700">{s.company_name ?? '—'}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-block text-xs font-semibold px-2.5 py-0.5 rounded-full capitalize ${PLAN_COLORS[s.plan]}`}>
                      {s.plan}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center text-gray-700">{s.seats}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${STATUS_COLORS[s.status] ?? 'bg-gray-100 text-gray-600'}`}>
                      {s.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center text-gray-500 text-xs capitalize">{s.billing_cycle ?? 'monthly'}</td>
                  <td className="px-4 py-3 text-gray-600 text-xs">
                    {s.billing_date
                      ? new Date(s.billing_date).toLocaleDateString('en-SG', { year: 'numeric', month: 'short', day: 'numeric' })
                      : '—'}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-800">
                    {s.status === 'active' ? `$${PLAN_MRR[s.plan].toFixed(2)}` : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => openEdit(s)}
                      className="text-xs font-medium text-violet-600 hover:text-violet-800 border border-violet-200 rounded px-2.5 py-1"
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Edit Modal */}
      {editSub && editForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900">Edit Subscription — {editSub.sub_account}</h3>
              <button onClick={() => { setEditSub(null); setEditForm(null) }} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
            </div>
            <form onSubmit={handleEdit} className="px-6 py-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Company Name</label>
                <input
                  value={editForm.company_name}
                  onChange={e => setEditForm(f => f ? { ...f, company_name: e.target.value } : f)}
                  placeholder="Company Inc."
                  className="input"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Plan</label>
                  <select
                    value={editForm.plan}
                    onChange={e => setEditForm(f => f ? { ...f, plan: e.target.value as Subscription['plan'] } : f)}
                    className="input"
                  >
                    {['free', 'basic', 'business', 'professional'].map(p => (
                      <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Seats</label>
                  <input
                    type="number"
                    min={1}
                    value={editForm.seats}
                    onChange={e => setEditForm(f => f ? { ...f, seats: e.target.value } : f)}
                    className="input"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                  <select
                    value={editForm.status}
                    onChange={e => setEditForm(f => f ? { ...f, status: e.target.value as Subscription['status'] } : f)}
                    className="input"
                  >
                    <option value="active">Active</option>
                    <option value="trialing">Trialing</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Billing Cycle</label>
                  <select
                    value={editForm.billing_cycle}
                    onChange={e => setEditForm(f => f ? { ...f, billing_cycle: e.target.value as 'monthly' | 'annual' } : f)}
                    className="input"
                  >
                    <option value="monthly">Monthly</option>
                    <option value="annual">Annual</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Next Billing Date</label>
                <input
                  type="date"
                  value={editForm.billing_date}
                  onChange={e => setEditForm(f => f ? { ...f, billing_date: e.target.value } : f)}
                  className="input"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea
                  rows={2}
                  value={editForm.notes}
                  onChange={e => setEditForm(f => f ? { ...f, notes: e.target.value } : f)}
                  placeholder="Internal notes…"
                  className="input resize-none"
                />
              </div>
              {msg && <p className={`text-sm ${msg.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>{msg.text}</p>}
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => { setEditSub(null); setEditForm(null) }} className="btn-ghost">Cancel</button>
                <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving…' : 'Save Changes'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

function SummaryCard({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <p className="text-xs font-medium text-gray-500 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      <p className="text-xs text-gray-400 mt-0.5">{sub}</p>
    </div>
  )
}
