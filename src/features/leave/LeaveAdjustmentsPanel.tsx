import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import type { LeaveAdjustment, LeaveType, User } from '@/types'

const LEAVE_TYPES: LeaveType[] = ['Annual', 'Medical', 'Time-off', 'PH/Off-in-Lieu', 'Other']

interface FormState {
  user_id: string
  type: LeaveType
  direction: 'credit' | 'debit'
  days: string
  remarks: string
}

const emptyForm = (userId = ''): FormState => ({
  user_id: userId, type: 'PH/Off-in-Lieu', direction: 'credit', days: '1', remarks: '',
})

const DAY_PRESETS = [
  { label: 'Half Day', value: '0.5' },
  { label: 'Full Day', value: '1' },
]

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function LeaveAdjustmentsPanel() {
  const { user } = useAuth()
  const [members, setMembers] = useState<User[]>([])
  const [adjustments, setAdjustments] = useState<LeaveAdjustment[]>([])
  const [filterUser, setFilterUser] = useState('all')
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<LeaveAdjustment | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm())
  const [customAmount, setCustomAmount] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    const [{ data: mem }, { data: adj }] = await Promise.all([
      supabase.from('users').select('*').eq('sub_account', user.sub_account).neq('id', user.id).order('name'),
      supabase.from('leave_adjustments').select('*, creator:users!leave_adjustments_created_by_fkey(name)').order('created_at', { ascending: false }),
    ])
    setMembers(((mem ?? []) as User[]).filter(m => m.status === 'active'))
    setAdjustments((adj ?? []) as LeaveAdjustment[])
    setLoading(false)
  }, [user])

  useEffect(() => { void load() }, [load])

  // Defense-in-depth: never render an adjustment for a user outside the
  // already correctly-scoped `members` list, even if the server ever
  // returns more than it should. Super-Admin is unrestricted by design.
  const memberIds = new Set(members.map(m => m.id))
  const scopedAdjustments = user?.role === 'Super-Admin'
    ? adjustments
    : adjustments.filter(a => memberIds.has(a.user_id))

  const visible = filterUser === 'all' ? scopedAdjustments : scopedAdjustments.filter(a => a.user_id === filterUser)

  function openNew() {
    setEditing(null)
    setForm(emptyForm(filterUser !== 'all' ? filterUser : members[0]?.id ?? ''))
    setCustomAmount(false)
    setError(null)
    setShowForm(true)
  }

  function openEdit(a: LeaveAdjustment) {
    setEditing(a)
    setForm({ user_id: a.user_id, type: a.type, direction: a.direction, days: String(a.days), remarks: a.remarks })
    setCustomAmount(a.type !== 'Time-off' && a.days !== 0.5 && a.days !== 1)
    setError(null)
    setShowForm(true)
  }

  function handleTypeChange(t: LeaveType) {
    setForm(f => ({ ...f, type: t, days: t === 'Time-off' ? '0.5' : '1' }))
    setCustomAmount(false)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!user) return
    const days = parseFloat(form.days)
    if (isNaN(days) || days <= 0) { setError('Enter a valid number of days.'); return }
    if (!form.remarks.trim()) { setError('Remarks are required.'); return }
    if (!form.user_id) { setError('Select an employee.'); return }

    setSaving(true); setError(null)
    const payload = {
      user_id: form.user_id,
      type: form.type,
      direction: form.direction,
      days,
      remarks: form.remarks.trim(),
      updated_at: new Date().toISOString(),
    }
    const { error: err } = editing
      ? await supabase.from('leave_adjustments').update(payload).eq('id', editing.id)
      : await supabase.from('leave_adjustments').insert({ ...payload, created_by: user.id })
    setSaving(false)
    if (err) { setError(err.message); return }
    setShowForm(false)
    void load()
  }

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this adjustment? This changes the employee’s leave balance immediately.')) return
    setDeletingId(id)
    setError(null)
    const { error: err } = await supabase.from('leave_adjustments').delete().eq('id', id)
    setDeletingId(null)
    if (err) { setError(`Could not delete adjustment: ${err.message}`); return }
    void load()
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="w-6 h-6 border-4 border-violet-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="font-semibold text-gray-900">Leave Balance Adjustments</h3>
          <p className="text-xs text-gray-400 mt-0.5">Credit or debit leave days, e.g. Off-in-Lieu for public holiday work.</p>
        </div>
        <div className="flex items-center gap-2">
          {members.length > 0 && (
            <select value={filterUser} onChange={e => setFilterUser(e.target.value)}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-violet-400">
              <option value="all">All employees</option>
              {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          )}
          <button onClick={openNew} disabled={members.length === 0}
            className="bg-violet-600 hover:bg-violet-700 text-white rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-40">
            + New Adjustment
          </button>
        </div>
      </div>

      {error && !showForm && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        {visible.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <p className="text-4xl mb-2">⚖️</p>
            <p className="text-sm">No leave adjustments yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  {['Date', 'Employee', 'Type', 'Adjustment', 'Remarks', 'By', ''].map(h => (
                    <th key={h} className="px-4 py-3 text-left font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {visible.map(a => {
                  const member = members.find(m => m.id === a.user_id)
                  return (
                    <tr key={a.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-500 whitespace-nowrap text-xs">{fmtDate(a.created_at)}</td>
                      <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">{member?.name ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{a.type}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                          a.direction === 'credit' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'
                        }`}>
                          {a.direction === 'credit' ? '+' : '−'}{a.days} day{a.days === 1 ? '' : 's'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-600 max-w-[220px] truncate" title={a.remarks}>{a.remarks}</td>
                      <td className="px-4 py-3 text-gray-400 whitespace-nowrap text-xs">{a.creator?.name ?? '—'}</td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-3">
                          <button onClick={() => openEdit(a)} className="text-xs text-gray-400 hover:text-violet-600">Edit</button>
                          <button
                            onClick={() => void handleDelete(a.id)}
                            disabled={deletingId === a.id}
                            className="text-xs text-red-400 hover:text-red-600 disabled:opacity-40"
                          >
                            {deletingId === a.id ? '…' : 'Delete'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-gray-900">{editing ? 'Edit Adjustment' : 'New Leave Adjustment'}</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
            </div>

            {error && (
              <div className="mb-4 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-sm text-red-600">{error}</div>
            )}

            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Employee</label>
                <select value={form.user_id} onChange={e => setForm(f => ({ ...f, user_id: e.target.value }))}
                  required disabled={!!editing}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 disabled:bg-gray-50 disabled:text-gray-500">
                  <option value="">Select employee…</option>
                  {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Leave Type</label>
                <select value={form.type} onChange={e => handleTypeChange(e.target.value as LeaveType)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500">
                  {LEAVE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Adjustment</label>
                <div className="flex gap-2">
                  {(['credit', 'debit'] as const).map(d => (
                    <button key={d} type="button" onClick={() => setForm(f => ({ ...f, direction: d }))}
                      className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors capitalize ${
                        form.direction === d
                          ? d === 'credit' ? 'bg-green-600 text-white border-green-600' : 'bg-red-500 text-white border-red-500'
                          : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                      }`}>
                      {d}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-sm font-medium text-gray-700">
                    {form.type === 'Time-off' ? 'Hours' : 'Amount'}
                  </label>
                  {form.type !== 'Time-off' && (
                    <button type="button" onClick={() => setCustomAmount(v => !v)}
                      className="text-xs text-violet-600 hover:text-violet-800 font-medium">
                      {customAmount ? 'Use half / full day' : 'Custom amount'}
                    </button>
                  )}
                </div>

                {form.type === 'Time-off' ? (
                  <input type="number" step="0.5" min="0.5" max="24"
                    value={form.days ? String(Number(form.days) * 8) : ''}
                    onChange={e => setForm(f => ({ ...f, days: e.target.value ? String(Number(e.target.value) / 8) : '' }))}
                    required
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500" />
                ) : customAmount ? (
                  <input type="number" step="0.5" min="0.5" value={form.days}
                    onChange={e => setForm(f => ({ ...f, days: e.target.value }))}
                    required
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500" />
                ) : (
                  <div className="flex gap-2">
                    {DAY_PRESETS.map(p => (
                      <button key={p.value} type="button" onClick={() => setForm(f => ({ ...f, days: p.value }))}
                        className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
                          form.days === p.value
                            ? 'bg-violet-600 text-white border-violet-600'
                            : 'bg-white text-gray-600 border-gray-200 hover:border-violet-300'
                        }`}>
                        {p.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Remarks *</label>
                <textarea value={form.remarks} onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))}
                  required rows={2} placeholder="e.g. Worked on National Day, 1 day in lieu"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none" />
              </div>

              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setShowForm(false)}
                  className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50">
                  Cancel
                </button>
                <button type="submit" disabled={saving}
                  className="flex-1 py-2.5 rounded-xl bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 disabled:opacity-50">
                  {saving ? 'Saving…' : editing ? 'Save Changes' : 'Add Adjustment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
