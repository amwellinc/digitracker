import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import type { SubAccount } from '@/types'
import { SubAccountDetailPanel } from './SubAccountDetailPanel'

const PLAN_OPTIONS = ['free', 'basic', 'business', 'professional'] as const
const STATUS_OPTIONS = ['active', 'trialing', 'cancelled', 'suspended'] as const

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
  suspended: 'bg-gray-100 text-gray-600',
}

interface CreateForm {
  code: string
  company_name: string
  admin_email: string
  admin_name: string
  plan: 'free' | 'basic' | 'business' | 'professional'
  seats: string
}

const emptyCreate = (): CreateForm => ({
  code: '', company_name: '', admin_email: '', admin_name: '',
  plan: 'basic', seats: '10',
})

interface EditForm {
  company_name: string
  admin_email: string
  plan: 'free' | 'basic' | 'business' | 'professional'
  seats: string
  status: 'active' | 'trialing' | 'cancelled' | 'suspended'
  notes: string
}

export function SubAccountsTab() {
  const [accounts, setAccounts] = useState<SubAccount[]>([])
  const [userCounts, setUserCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [viewAccount, setViewAccount] = useState<SubAccount | null>(null)
  const [editAccount, setEditAccount] = useState<SubAccount | null>(null)
  const [createForm, setCreateForm] = useState<CreateForm>(emptyCreate())
  const [editForm, setEditForm] = useState<EditForm | null>(null)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('sub_accounts')
      .select('*')
      .order('created_at', { ascending: false })
    setAccounts((data ?? []) as SubAccount[])

    const { data: users } = await supabase
      .from('users')
      .select('sub_account')
    const counts: Record<string, number> = {}
    for (const u of (users ?? []) as { sub_account: string }[]) {
      counts[u.sub_account] = (counts[u.sub_account] ?? 0) + 1
    }
    setUserCounts(counts)
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  function openEdit(a: SubAccount) {
    setEditForm({
      company_name: a.company_name,
      admin_email: a.admin_email ?? '',
      plan: a.plan,
      seats: String(a.seats),
      status: a.status,
      notes: a.notes ?? '',
    })
    setEditAccount(a)
    setMsg(null)
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setMsg(null)
    const code = createForm.code.toUpperCase().trim()

    const { error: saErr } = await supabase.from('sub_accounts').insert({
      code,
      company_name: createForm.company_name.trim(),
      admin_email: createForm.admin_email.toLowerCase().trim(),
      plan: createForm.plan,
      seats: Number(createForm.seats),
      status: 'active',
    })
    if (saErr) { setMsg({ type: 'error', text: saErr.message }); setSaving(false); return }

    const { error: uErr } = await supabase.from('users').insert({
      email: createForm.admin_email.toLowerCase().trim(),
      name: createForm.admin_name.trim() || createForm.admin_email.split('@')[0],
      role: 'Admin',
      sub_account: code,
      annual_leave: 14,
      time_off: 40,
      reporting_time_in: '09:00',
      reporting_time_out: '18:00',
      country: 'SG',
    })
    if (uErr) {
      setMsg({ type: 'error', text: `Sub-account created but admin user failed: ${uErr.message}` })
      setSaving(false)
      void load()
      return
    }

    const { error: subErr } = await supabase.from('subscriptions').insert({
      sub_account: code,
      plan: createForm.plan,
      seats: Number(createForm.seats),
      status: 'active',
      billing_cycle: 'monthly',
      company_name: createForm.company_name.trim(),
    })
    if (subErr) {
      setMsg({ type: 'error', text: `Sub-account created but subscription record failed: ${subErr.message}` })
    } else {
      setMsg({ type: 'success', text: `Sub-account ${code} created. Admin can now log in with ${createForm.admin_email}.` })
    }

    setSaving(false)
    void load()
    setTimeout(() => { setShowCreate(false); setCreateForm(emptyCreate()); setMsg(null) }, 3000)
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editAccount || !editForm) return
    setSaving(true)
    setMsg(null)

    const { error } = await supabase
      .from('sub_accounts')
      .update({
        company_name: editForm.company_name.trim(),
        admin_email: editForm.admin_email.toLowerCase().trim(),
        plan: editForm.plan,
        seats: Number(editForm.seats),
        status: editForm.status,
        notes: editForm.notes.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq('code', editAccount.code)

    if (!error) {
      await supabase
        .from('subscriptions')
        .update({ plan: editForm.plan, seats: Number(editForm.seats), company_name: editForm.company_name.trim() })
        .eq('sub_account', editAccount.code)
    }

    setSaving(false)
    if (error) { setMsg({ type: 'error', text: error.message }); return }
    void load()
    setEditAccount(null)
    setEditForm(null)
  }

  const filtered = accounts.filter(a =>
    a.code.toLowerCase().includes(search.toLowerCase()) ||
    a.company_name.toLowerCase().includes(search.toLowerCase()) ||
    (a.admin_email ?? '').toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Sub-Accounts</h2>
          <p className="text-sm text-gray-500">{accounts.length} sub-account{accounts.length !== 1 ? 's' : ''} registered</p>
        </div>
        <button
          onClick={() => { setCreateForm(emptyCreate()); setMsg(null); setShowCreate(true) }}
          className="flex items-center gap-2 bg-violet-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-violet-700 transition-colors"
        >
          <span className="text-lg leading-none">+</span> New Sub-Account
        </button>
      </div>

      <input
        placeholder="Search by code, company, or email…"
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="mb-4 w-full max-w-xs border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
      />

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-40 text-sm text-gray-400">Loading…</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Code</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Company</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Admin Email</th>
                <th className="text-center px-4 py-3 font-medium text-gray-600">Plan</th>
                <th className="text-center px-4 py-3 font-medium text-gray-600">Seats</th>
                <th className="text-center px-4 py-3 font-medium text-gray-600">Users</th>
                <th className="text-center px-4 py-3 font-medium text-gray-600">Status</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.length === 0 && (
                <tr><td colSpan={8} className="text-center py-10 text-gray-400">No sub-accounts found.</td></tr>
              )}
              {filtered.map(a => (
                <tr key={a.code} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <span className="font-mono font-bold text-gray-800 bg-gray-100 px-2 py-0.5 rounded">{a.code}</span>
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-900">{a.company_name || '—'}</td>
                  <td className="px-4 py-3 text-gray-600 text-xs">{a.admin_email ?? '—'}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-block text-xs font-semibold px-2.5 py-0.5 rounded-full capitalize ${PLAN_COLORS[a.plan]}`}>
                      {a.plan}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center text-gray-700">{a.seats}</td>
                  <td className="px-4 py-3 text-center">
                    <span className="font-semibold text-gray-800">{userCounts[a.code] ?? 0}</span>
                    <span className="text-gray-400 text-xs"> / {a.seats}</span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${STATUS_COLORS[a.status]}`}>
                      {a.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => setViewAccount(a)}
                        className="text-xs font-medium text-gray-600 hover:text-gray-900 border border-gray-200 rounded px-2.5 py-1"
                      >
                        View
                      </button>
                      <button
                        onClick={() => openEdit(a)}
                        className="text-xs font-medium text-violet-600 hover:text-violet-800 border border-violet-200 rounded px-2.5 py-1"
                      >
                        Edit
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Detail Panel slide-over */}
      {viewAccount && (
        <SubAccountDetailPanel account={viewAccount} onClose={() => setViewAccount(null)} />
      )}

      {/* Create Modal */}
      {showCreate && (
        <Modal title="New Sub-Account" onClose={() => setShowCreate(false)}>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Sub-Account Code</label>
                <input
                  required
                  value={createForm.code}
                  onChange={e => setCreateForm(f => ({ ...f, code: e.target.value.toUpperCase().replace(/\s/g, '') }))}
                  placeholder="AM333"
                  maxLength={10}
                  className="input font-mono uppercase"
                />
                <p className="text-xs text-gray-400 mt-0.5">Unique identifier, no spaces</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Company Name</label>
                <input
                  required
                  value={createForm.company_name}
                  onChange={e => setCreateForm(f => ({ ...f, company_name: e.target.value }))}
                  placeholder="AMUSA International"
                  className="input"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Admin Email</label>
              <input
                required
                type="email"
                value={createForm.admin_email}
                onChange={e => setCreateForm(f => ({ ...f, admin_email: e.target.value }))}
                placeholder="admin@company.com"
                className="input"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Admin Name</label>
              <input
                value={createForm.admin_name}
                onChange={e => setCreateForm(f => ({ ...f, admin_name: e.target.value }))}
                placeholder="John Smith (optional)"
                className="input"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Plan</label>
                <select
                  value={createForm.plan}
                  onChange={e => setCreateForm(f => ({ ...f, plan: e.target.value as CreateForm['plan'] }))}
                  className="input"
                >
                  {PLAN_OPTIONS.map(p => <option key={p} value={p} className="capitalize">{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Seats</label>
                <input
                  type="number"
                  min={1}
                  value={createForm.seats}
                  onChange={e => setCreateForm(f => ({ ...f, seats: e.target.value }))}
                  className="input"
                />
              </div>
            </div>
            {msg && <p className={`text-sm ${msg.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>{msg.text}</p>}
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setShowCreate(false)} className="btn-ghost">Cancel</button>
              <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Creating…' : 'Create Sub-Account'}</button>
            </div>
          </form>
        </Modal>
      )}

      {/* Edit Modal */}
      {editAccount && editForm && (
        <Modal title={`Edit — ${editAccount.code}`} onClose={() => { setEditAccount(null); setEditForm(null) }}>
          <form onSubmit={handleEdit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Company Name</label>
              <input
                required
                value={editForm.company_name}
                onChange={e => setEditForm(f => f ? { ...f, company_name: e.target.value } : f)}
                className="input"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Admin Email</label>
              <input
                type="email"
                value={editForm.admin_email}
                onChange={e => setEditForm(f => f ? { ...f, admin_email: e.target.value } : f)}
                className="input"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Plan</label>
                <select
                  value={editForm.plan}
                  onChange={e => setEditForm(f => f ? { ...f, plan: e.target.value as EditForm['plan'] } : f)}
                  className="input"
                >
                  {PLAN_OPTIONS.map(p => <option key={p} value={p} className="capitalize">{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
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
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
              <select
                value={editForm.status}
                onChange={e => setEditForm(f => f ? { ...f, status: e.target.value as EditForm['status'] } : f)}
                className="input"
              >
                {STATUS_OPTIONS.map(s => <option key={s} value={s} className="capitalize">{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
              <textarea
                rows={2}
                value={editForm.notes}
                onChange={e => setEditForm(f => f ? { ...f, notes: e.target.value } : f)}
                placeholder="Internal notes about this account…"
                className="input resize-none"
              />
            </div>
            {msg && <p className={`text-sm ${msg.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>{msg.text}</p>}
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => { setEditAccount(null); setEditForm(null) }} className="btn-ghost">Cancel</button>
              <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving…' : 'Save Changes'}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>
        <div className="px-6 py-4">{children}</div>
      </div>
    </div>
  )
}
