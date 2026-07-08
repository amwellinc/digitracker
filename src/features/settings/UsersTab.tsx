import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import type { User, UserRole, UserCountry } from '@/types'

const ROLES: UserRole[] = ['Super-admin', 'Manager', 'Staff']

const COUNTRY_OPTIONS: { code: UserCountry; flag: string; label: string; dialCode: string }[] = [
  { code: 'SG', flag: '🇸🇬', label: 'Singapore',   dialCode: '+65' },
  { code: 'MY', flag: '🇲🇾', label: 'Malaysia',    dialCode: '+60' },
  { code: 'PH', flag: '🇵🇭', label: 'Philippines', dialCode: '+63' },
]

const ROLE_COLORS: Record<UserRole, string> = {
  'Super-admin': 'bg-violet-100 text-violet-700',
  'Manager':     'bg-blue-100 text-blue-700',
  'Staff':       'bg-gray-100 text-gray-600',
}

interface UserForm {
  name: string
  email: string
  role: UserRole
  manager_id: string
  annual_leave: string
  time_off: string
  reporting_time_in: string
  reporting_time_out: string
  country: UserCountry
  phone: string
}

const emptyForm = (): UserForm => ({
  name: '', email: '', role: 'Staff', manager_id: '',
  annual_leave: '14', time_off: '5',
  reporting_time_in: '10:00', reporting_time_out: '19:00',
  country: 'SG', phone: '',
})

export function UsersTab() {
  const { user: currentUser } = useAuth()
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [editUser, setEditUser] = useState<User | null>(null)
  const [deleteUser, setDeleteUser] = useState<User | null>(null)
  const [form, setForm] = useState<UserForm>(emptyForm())
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [search, setSearch] = useState('')

  const fetchUsers = useCallback(async () => {
    if (!currentUser) return
    setLoading(true)
    const { data } = await supabase
      .from('users')
      .select('*')
      .eq('sub_account', currentUser.sub_account)
      .order('created_at', { ascending: true })
    setUsers((data as User[]) ?? [])
    setLoading(false)
  }, [currentUser])

  useEffect(() => { void fetchUsers() }, [fetchUsers])

  function openAdd() {
    setForm(emptyForm())
    setMsg(null)
    setShowAddModal(true)
  }

  function openEdit(u: User) {
    setForm({
      name: u.name,
      email: u.email,
      role: u.role,
      manager_id: u.manager_id ?? '',
      annual_leave: String(u.annual_leave),
      time_off: String(u.time_off),
      reporting_time_in: u.reporting_time_in,
      reporting_time_out: u.reporting_time_out,
      country: u.country ?? 'SG',
      phone: u.phone ?? '',
    })
    setMsg(null)
    setEditUser(u)
  }

  function patch(key: keyof UserForm, val: string) {
    setForm(f => ({ ...f, [key]: val }))
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!currentUser) return
    setSaving(true)
    setMsg(null)
    const { error } = await supabase.from('users').insert({
      name: form.name.trim(),
      email: form.email.toLowerCase().trim(),
      role: form.role,
      sub_account: currentUser.sub_account,
      manager_id: form.manager_id || null,
      annual_leave: Number(form.annual_leave),
      time_off: Number(form.time_off),
      reporting_time_in: form.reporting_time_in,
      reporting_time_out: form.reporting_time_out,
      country: form.country,
      phone: form.phone.trim() || null,
    })
    setSaving(false)
    if (error) { setMsg({ type: 'error', text: error.message }); return }
    setMsg({ type: 'success', text: `${form.name} added. They can now log in with their email.` })
    void fetchUsers()
    setTimeout(() => { setShowAddModal(false); setMsg(null) }, 2000)
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editUser) return
    setSaving(true)
    setMsg(null)
    const { error } = await supabase.from('users').update({
      name: form.name.trim(),
      role: form.role,
      manager_id: form.manager_id || null,
      annual_leave: Number(form.annual_leave),
      time_off: Number(form.time_off),
      reporting_time_in: form.reporting_time_in,
      reporting_time_out: form.reporting_time_out,
      country: form.country,
      phone: form.phone.trim() || null,
    }).eq('id', editUser.id)
    setSaving(false)
    if (error) { setMsg({ type: 'error', text: error.message }); return }
    void fetchUsers()
    setEditUser(null)
  }

  async function handleDelete() {
    if (!deleteUser) return
    setDeleting(true)
    const { error } = await supabase.from('users').delete().eq('id', deleteUser.id)
    setDeleting(false)
    if (error) { alert(error.message); return }
    void fetchUsers()
    setDeleteUser(null)
  }

  const managers = users.filter(u => u.role === 'Manager' || u.role === 'Super-admin')
  const filtered = users.filter(u =>
    u.name.toLowerCase().includes(search.toLowerCase()) ||
    u.email.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Users & Roles</h2>
          <p className="text-sm text-gray-500">{users.length} user{users.length !== 1 ? 's' : ''} in this workspace</p>
        </div>
        <button
          onClick={openAdd}
          className="flex items-center gap-2 bg-violet-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-violet-700 transition-colors"
        >
          <span className="text-lg leading-none">+</span> Add User
        </button>
      </div>

      {/* Search */}
      <div className="mb-4">
        <input
          placeholder="Search by name or email…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full max-w-xs border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
        />
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-40 text-sm text-gray-400">Loading users…</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Name</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Email</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Role</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Manager</th>
                <th className="text-center px-4 py-3 font-medium text-gray-600">Annual</th>
                <th className="text-center px-4 py-3 font-medium text-gray-600">Time-off</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Hours</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Country</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Phone</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={10} className="text-center py-10 text-gray-400">
                    {search ? 'No users match your search.' : 'No users yet. Add your first user.'}
                  </td>
                </tr>
              )}
              {filtered.map(u => {
                const manager = users.find(m => m.id === u.manager_id)
                const isSelf = u.id === currentUser?.id
                return (
                  <tr key={u.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {u.profile_image ? (
                          <img src={u.profile_image} alt="" className="w-7 h-7 rounded-full object-cover" />
                        ) : (
                          <div className="w-7 h-7 rounded-full bg-violet-200 text-violet-700 text-xs font-bold flex items-center justify-center">
                            {u.name.slice(0, 2).toUpperCase()}
                          </div>
                        )}
                        <span className="font-medium text-gray-900">
                          {u.name}
                          {isSelf && <span className="ml-1 text-xs text-gray-400">(you)</span>}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{u.email}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block text-xs font-semibold px-2.5 py-0.5 rounded-full ${ROLE_COLORS[u.role]}`}>
                        {u.role}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{manager?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-center text-gray-700">{u.annual_leave}d</td>
                    <td className="px-4 py-3 text-center text-gray-700">{u.time_off}d</td>
                    <td className="px-4 py-3 text-gray-600 text-xs">{u.reporting_time_in} – {u.reporting_time_out}</td>
                    <td className="px-4 py-3 text-gray-700 text-sm">
                      {COUNTRY_OPTIONS.find(c => c.code === u.country)?.flag ?? '🌐'}{' '}
                      <span className="text-xs text-gray-500">{u.country ?? '—'}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-xs">
                      {u.phone
                        ? <>{COUNTRY_OPTIONS.find(c => c.code === u.country)?.dialCode} {u.phone}</>
                        : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => openEdit(u)}
                          className="text-xs font-medium text-violet-600 hover:text-violet-800 border border-violet-200 rounded px-2.5 py-1"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => !isSelf && setDeleteUser(u)}
                          disabled={isSelf}
                          className="text-xs font-medium text-red-500 hover:text-red-700 border border-red-200 rounded px-2.5 py-1 disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Add Modal */}
      {showAddModal && (
        <Modal title="Add User" onClose={() => setShowAddModal(false)}>
          <form onSubmit={handleAdd} className="space-y-4">
            <FormRow label="Full Name">
              <input required value={form.name} onChange={e => patch('name', e.target.value)}
                placeholder="Jane Smith"
                className="input" />
            </FormRow>
            <FormRow label="Email">
              <input required type="email" value={form.email} onChange={e => patch('email', e.target.value)}
                placeholder="jane@company.com"
                className="input" />
            </FormRow>
            <FormRow label="Role">
              <RoleSelect value={form.role} onChange={v => patch('role', v)} />
            </FormRow>
            <FormRow label="Manager">
              <ManagerSelect value={form.manager_id} managers={managers} onChange={v => patch('manager_id', v)} />
            </FormRow>
            <div className="grid grid-cols-2 gap-3">
              <FormRow label="Country">
                <CountrySelect value={form.country as UserCountry} onChange={v => patch('country', v)} />
              </FormRow>
              <FormRow label="Phone Number">
                <PhoneInput country={form.country as UserCountry} value={form.phone} onChange={v => patch('phone', v)} />
              </FormRow>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormRow label="Annual Leave (days)">
                <input type="number" min={0} value={form.annual_leave} onChange={e => patch('annual_leave', e.target.value)} className="input" />
              </FormRow>
              <FormRow label="Time-off (days)">
                <input type="number" min={0} value={form.time_off} onChange={e => patch('time_off', e.target.value)} className="input" />
              </FormRow>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormRow label="Clock-in Time">
                <input type="time" value={form.reporting_time_in} onChange={e => patch('reporting_time_in', e.target.value)} className="input" />
              </FormRow>
              <FormRow label="Clock-out Time">
                <input type="time" value={form.reporting_time_out} onChange={e => patch('reporting_time_out', e.target.value)} className="input" />
              </FormRow>
            </div>
            {msg && <p className={`text-sm ${msg.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>{msg.text}</p>}
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setShowAddModal(false)} className="btn-ghost">Cancel</button>
              <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Adding…' : 'Add User'}</button>
            </div>
          </form>
        </Modal>
      )}

      {/* Edit Modal */}
      {editUser && (
        <Modal title={`Edit — ${editUser.name}`} onClose={() => setEditUser(null)}>
          <form onSubmit={handleEdit} className="space-y-4">
            <FormRow label="Full Name">
              <input required value={form.name} onChange={e => patch('name', e.target.value)} className="input" />
            </FormRow>
            <FormRow label="Email">
              <input value={form.email} readOnly className="input bg-gray-50 text-gray-500 cursor-not-allowed" />
            </FormRow>
            <FormRow label="Role">
              <RoleSelect value={form.role} onChange={v => patch('role', v)} />
            </FormRow>
            <FormRow label="Manager">
              <ManagerSelect value={form.manager_id} managers={managers.filter(m => m.id !== editUser.id)} onChange={v => patch('manager_id', v)} />
            </FormRow>
            <div className="grid grid-cols-2 gap-3">
              <FormRow label="Country">
                <CountrySelect value={form.country as UserCountry} onChange={v => patch('country', v)} />
              </FormRow>
              <FormRow label="Phone Number">
                <PhoneInput country={form.country as UserCountry} value={form.phone} onChange={v => patch('phone', v)} />
              </FormRow>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormRow label="Annual Leave (days)">
                <input type="number" min={0} value={form.annual_leave} onChange={e => patch('annual_leave', e.target.value)} className="input" />
              </FormRow>
              <FormRow label="Time-off (days)">
                <input type="number" min={0} value={form.time_off} onChange={e => patch('time_off', e.target.value)} className="input" />
              </FormRow>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormRow label="Clock-in Time">
                <input type="time" value={form.reporting_time_in} onChange={e => patch('reporting_time_in', e.target.value)} className="input" />
              </FormRow>
              <FormRow label="Clock-out Time">
                <input type="time" value={form.reporting_time_out} onChange={e => patch('reporting_time_out', e.target.value)} className="input" />
              </FormRow>
            </div>
            {msg && <p className={`text-sm ${msg.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>{msg.text}</p>}
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setEditUser(null)} className="btn-ghost">Cancel</button>
              <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving…' : 'Save Changes'}</button>
            </div>
          </form>
        </Modal>
      )}

      {/* Delete Confirm Modal */}
      {deleteUser && (
        <Modal title="Remove User" onClose={() => setDeleteUser(null)}>
          <p className="text-sm text-gray-600 mb-2">
            Are you sure you want to remove <strong>{deleteUser.name}</strong>?
          </p>
          <p className="text-xs text-gray-500 mb-4">
            This will delete their account, time logs, and all associated data from this workspace. This action cannot be undone.
          </p>
          <div className="flex justify-end gap-3">
            <button onClick={() => setDeleteUser(null)} className="btn-ghost">Cancel</button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="bg-red-600 text-white text-sm font-medium rounded-lg px-4 py-2 hover:bg-red-700 disabled:opacity-50"
            >
              {deleting ? 'Removing…' : 'Remove User'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>
        <div className="px-6 py-4">{children}</div>
      </div>
    </div>
  )
}

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {children}
    </div>
  )
}

function RoleSelect({ value, onChange }: { value: UserRole; onChange: (v: UserRole) => void }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value as UserRole)}
      className="input"
    >
      {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
    </select>
  )
}

function ManagerSelect({ value, managers, onChange }: {
  value: string
  managers: User[]
  onChange: (v: string) => void
}) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className="input">
      <option value="">— No manager —</option>
      {managers.map(m => <option key={m.id} value={m.id}>{m.name} ({m.role})</option>)}
    </select>
  )
}

function CountrySelect({ value, onChange }: { value: UserCountry; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className="input">
      {COUNTRY_OPTIONS.map(c => (
        <option key={c.code} value={c.code}>{c.flag} {c.label}</option>
      ))}
    </select>
  )
}

function PhoneInput({ country, value, onChange }: {
  country: UserCountry
  value: string
  onChange: (v: string) => void
}) {
  const dialCode = COUNTRY_OPTIONS.find(c => c.code === country)?.dialCode ?? '+65'
  return (
    <div className="flex gap-1">
      <span className="inline-flex items-center px-2.5 border border-gray-300 rounded-lg bg-gray-50 text-gray-500 text-xs select-none whitespace-nowrap">
        {dialCode}
      </span>
      <input
        type="tel"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="91234567"
        className="input flex-1 min-w-0"
      />
    </div>
  )
}
