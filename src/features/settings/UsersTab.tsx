import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import type { User, UserRole, UserCountry } from '@/types'
import { COUNTRY_OPTIONS, ROLE_OPTIONS, ROLE_COLORS } from '@/lib/constants'

const ROLES: UserRole[] = ROLE_OPTIONS

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
  annual_leave: '14', time_off: '40',
  reporting_time_in: '10:00', reporting_time_out: '19:00',
  country: 'SG', phone: '',
})

function avatarBg(role: UserRole) {
  switch (role) {
    case 'Admin':   return 'bg-violet-100 text-violet-700'
    case 'Manager': return 'bg-blue-100 text-blue-700'
    default:        return 'bg-gray-100 text-gray-600'
  }
}

function initials(name: string) {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

// supabase-js doesn't parse a Functions error response body into `error.message` —
// the real message lives on `error.context` (the raw Response). Fall back gracefully.
async function extractFunctionError(error: unknown, data: unknown): Promise<string | undefined> {
  if (!error) return (data as { error?: string } | null)?.error
  const ctx = (error as { context?: Response }).context
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = await ctx.json() as { error?: string }
      if (body?.error) return body.error
    } catch {
      // fall through to generic message below
    }
  }
  return (error as { message?: string }).message ?? 'Failed to set password.'
}

export function UsersTab() {
  const { user: currentUser } = useAuth()
  const [users, setUsers]     = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState('')

  const [showAddModal, setShowAddModal]   = useState(false)
  const [viewUser, setViewUser]           = useState<User | null>(null)
  const [editUser, setEditUser]           = useState<User | null>(null)
  const [deleteUser, setDeleteUser]       = useState<User | null>(null)

  const [form, setForm]     = useState<UserForm>(emptyForm())
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [msg, setMsg]       = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [inviting, setInviting] = useState<string | null>(null)  // userId being invited
  const [inviteAllBusy, setInviteAllBusy] = useState(false)
  const [passwordUser, setPasswordUser] = useState<User | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [settingPassword, setSettingPassword] = useState(false)
  const [pwMsg, setPwMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

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

  function openAdd() { setForm(emptyForm()); setMsg(null); setShowAddModal(true) }

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
    setViewUser(null)
    setEditUser(u)
  }

  function patch(key: keyof UserForm, val: string) {
    setForm(f => ({ ...f, [key]: val }))
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!currentUser) return
    setSaving(true); setMsg(null)
    const email = form.email.toLowerCase().trim()
    const { error } = await supabase.from('users').insert({
      name: form.name.trim(),
      email,
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
    if (error) {
      setSaving(false)
      setMsg({ type: 'error', text: error.message })
      return
    }

    // Creating the user record does not give them a way to sign in on its own —
    // send the magic-link invite immediately so "Add User" actually grants access.
    const { error: inviteError } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    })
    setSaving(false)
    setMsg(inviteError
      ? { type: 'error', text: `${form.name} added, but the invite email failed to send: ${inviteError.message}. Use the Invite button on their row to retry.` }
      : { type: 'success', text: `${form.name} added and invited — check ${email} for a magic link.` }
    )
    void fetchUsers()
    setTimeout(() => { setShowAddModal(false); setMsg(null) }, 2000)
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editUser) return
    setSaving(true); setMsg(null)
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

  async function sendInvite(u: User) {
    setInviting(u.id)
    const appUrl = import.meta.env.VITE_APP_URL ?? window.location.origin
    const { error } = await supabase.auth.signInWithOtp({
      email: u.email,
      options: { emailRedirectTo: appUrl },
    })
    setInviting(null)
    if (error) {
      setMsg({ type: 'error', text: `Could not invite ${u.name}: ${error.message}` })
    } else {
      setMsg({ type: 'success', text: `Magic link sent to ${u.email}` })
    }
    setTimeout(() => setMsg(null), 3000)
  }

  async function inviteAll() {
    setInviteAllBusy(true)
    const appUrl = import.meta.env.VITE_APP_URL ?? window.location.origin
    let sent = 0; let failed = 0
    for (const u of users) {
      const { error } = await supabase.auth.signInWithOtp({
        email: u.email,
        options: { emailRedirectTo: appUrl },
      })
      if (error) failed++ ; else sent++
      // small delay to avoid hammering SMTP
      await new Promise(r => setTimeout(r, 500))
    }
    setInviteAllBusy(false)
    setMsg({
      type: failed === 0 ? 'success' : 'error',
      text: `Sent ${sent} invite${sent !== 1 ? 's' : ''}${failed > 0 ? `, ${failed} failed` : ''}.`,
    })
    setTimeout(() => setMsg(null), 5000)
  }

  function openSetPassword(u: User) {
    setPasswordUser(u)
    setNewPassword('')
    setConfirmPassword('')
    setPwMsg(null)
  }

  async function handleSetPassword(e: React.FormEvent) {
    e.preventDefault()
    if (!passwordUser) return
    if (newPassword !== confirmPassword) {
      setPwMsg({ type: 'error', text: 'Passwords do not match.' })
      return
    }
    if (newPassword.length < 8) {
      setPwMsg({ type: 'error', text: 'Password must be at least 8 characters.' })
      return
    }
    setSettingPassword(true); setPwMsg(null)
    const { data, error } = await supabase.functions.invoke('admin-set-password', {
      body: { targetUserId: passwordUser.id, password: newPassword },
    })
    setSettingPassword(false)
    const fnError = await extractFunctionError(error, data)
    if (fnError) {
      setPwMsg({ type: 'error', text: fnError })
      return
    }
    setPwMsg({ type: 'success', text: `Password set for ${passwordUser.name}. They can now sign in with email + password — no magic link needed.` })
    setNewPassword(''); setConfirmPassword('')
    setTimeout(() => { setPasswordUser(null); setPwMsg(null) }, 3000)
  }

  const managers = users.filter(u => u.role === 'Manager' || u.role === 'Admin')
  const filtered = users.filter(u =>
    u.name.toLowerCase().includes(search.toLowerCase()) ||
    u.email.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div>
      {/* Toast */}
      {msg && (
        <div className={`mb-4 px-4 py-3 rounded-lg text-sm font-medium ${
          msg.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'
        }`}>
          {msg.text}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Users & Roles</h2>
          <p className="text-sm text-gray-500">{users.length} user{users.length !== 1 ? 's' : ''} in this workspace</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={inviteAll}
            disabled={inviteAllBusy || users.length === 0}
            className="flex items-center gap-2 bg-teal-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-teal-700 disabled:opacity-50 transition-colors"
          >
            {inviteAllBusy ? '⏳ Sending…' : '📧 Invite All'}
          </button>
          <button
            onClick={openAdd}
            className="flex items-center gap-2 bg-violet-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-violet-700 transition-colors"
          >
            <span className="text-lg leading-none">+</span> Add User
          </button>
        </div>
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
      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        {loading ? (
          <div className="flex items-center justify-center h-40 text-sm text-gray-400">Loading users…</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">User</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">Email</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">Role</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">Manager</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">Country</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600 whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-10 text-gray-400">
                    {search ? 'No users match your search.' : 'No users yet. Add your first user.'}
                  </td>
                </tr>
              )}
              {filtered.map(u => {
                const manager = users.find(m => m.id === u.manager_id)
                const isSelf  = u.id === currentUser?.id
                const country = COUNTRY_OPTIONS.find(c => c.code === u.country)
                return (
                  <tr key={u.id} className="hover:bg-gray-50 transition-colors">
                    {/* Avatar + Name — click directly opens Edit */}
                    <td
                      className="px-4 py-3 cursor-pointer"
                      onClick={() => openEdit(u)}
                    >
                      <div className="flex items-center gap-3">
                        {u.profile_image ? (
                          <img
                            src={u.profile_image}
                            alt={u.name}
                            className="w-10 h-10 rounded-full object-cover ring-2 ring-white shadow-sm flex-shrink-0"
                          />
                        ) : (
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ring-2 ring-white shadow-sm ${avatarBg(u.role)}`}>
                            {initials(u.name)}
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="font-semibold text-violet-700 hover:underline truncate">
                            {u.name}
                            {isSelf && <span className="ml-1.5 text-xs font-normal text-gray-400">(you)</span>}
                          </p>
                          <p className="text-xs text-gray-400 mt-0.5">{u.reporting_time_in} – {u.reporting_time_out}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-sm">{u.email}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block text-xs font-semibold px-2.5 py-0.5 rounded-full ${ROLE_COLORS[u.role]}`}>
                        {u.role}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-sm whitespace-nowrap">{manager?.name ?? <span className="text-gray-300">—</span>}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-1.5 text-sm text-gray-700">
                        <span>{country?.flag ?? '🌐'}</span>
                        <span className="text-xs text-gray-500">{country?.label ?? u.country ?? '—'}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => void sendInvite(u)}
                          disabled={inviting === u.id}
                          className="text-xs font-semibold text-white bg-teal-600 hover:bg-teal-700 rounded-md px-3 py-1.5 transition-colors disabled:opacity-50"
                        >
                          {inviting === u.id ? '⏳' : '📧 Invite'}
                        </button>
                        <button
                          onClick={() => openSetPassword(u)}
                          className="text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-md px-3 py-1.5 transition-colors"
                        >
                          🔑 Set Password
                        </button>
                        <button
                          onClick={() => setViewUser(u)}
                          className="text-xs font-medium text-gray-500 hover:text-gray-700 border border-gray-200 hover:border-gray-300 rounded-md px-3 py-1.5 transition-colors"
                        >
                          View
                        </button>
                        <button
                          onClick={() => openEdit(u)}
                          className="text-xs font-semibold text-white bg-violet-600 hover:bg-violet-700 rounded-md px-3 py-1.5 transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => !isSelf && setDeleteUser(u)}
                          disabled={isSelf}
                          className="text-xs font-semibold text-white bg-red-500 hover:bg-red-600 rounded-md px-3 py-1.5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          Delete
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

      {/* ── Profile View Modal ──────────────────────────────────────────── */}
      {viewUser && !editUser && !deleteUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setViewUser(null)}>
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Profile header */}
            <div className="relative bg-gradient-to-br from-violet-600 to-violet-800 px-6 pt-8 pb-16">
              <button
                onClick={() => setViewUser(null)}
                className="absolute top-4 right-4 text-white/70 hover:text-white text-xl leading-none"
              >
                &times;
              </button>
              <div className="flex flex-col items-center text-center">
                {viewUser.profile_image ? (
                  <img
                    src={viewUser.profile_image}
                    alt={viewUser.name}
                    className="w-20 h-20 rounded-full object-cover ring-4 ring-white/30 shadow-lg mb-3"
                  />
                ) : (
                  <div className={`w-20 h-20 rounded-full flex items-center justify-center text-2xl font-bold ring-4 ring-white/30 shadow-lg mb-3 ${avatarBg(viewUser.role)}`}>
                    {initials(viewUser.name)}
                  </div>
                )}
                <h2 className="text-xl font-bold text-white">{viewUser.name}</h2>
                <p className="text-violet-200 text-sm mt-0.5">{viewUser.email}</p>
                <span className={`mt-2 inline-block text-xs font-semibold px-3 py-1 rounded-full ${ROLE_COLORS[viewUser.role]}`}>
                  {viewUser.role}
                </span>
              </div>
            </div>

            {/* Profile details */}
            <div className="-mt-8 mx-4 bg-white rounded-xl shadow border border-gray-100 divide-y divide-gray-50">
              <ProfileRow icon="👔" label="Manager">
                {users.find(m => m.id === viewUser.manager_id)?.name ?? <span className="text-gray-400">No manager assigned</span>}
              </ProfileRow>
              <ProfileRow icon="🌏" label="Country">
                {(() => {
                  const c = COUNTRY_OPTIONS.find(x => x.code === viewUser.country)
                  return c ? `${c.flag} ${c.label}` : viewUser.country ?? '—'
                })()}
              </ProfileRow>
              <ProfileRow icon="📞" label="Phone">
                {viewUser.phone
                  ? `${COUNTRY_OPTIONS.find(c => c.code === viewUser.country)?.dialCode ?? ''} ${viewUser.phone}`.trim()
                  : <span className="text-gray-400">Not provided</span>}
              </ProfileRow>
              <ProfileRow icon="⏰" label="Work Hours">
                {viewUser.reporting_time_in} – {viewUser.reporting_time_out}
              </ProfileRow>
              <ProfileRow icon="🌴" label="Annual Leave">
                {viewUser.annual_leave} days
              </ProfileRow>
              <ProfileRow icon="🕐" label="Time-Off Balance">
                {viewUser.time_off} hours
              </ProfileRow>
              <ProfileRow icon="📅" label="Member Since">
                {new Date(viewUser.created_at).toLocaleDateString('en-SG', { year: 'numeric', month: 'long', day: 'numeric' })}
              </ProfileRow>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between px-4 py-4">
              <button
                onClick={() => { setDeleteUser(viewUser); setViewUser(null) }}
                disabled={viewUser.id === currentUser?.id}
                className="text-sm font-semibold text-white bg-red-500 hover:bg-red-600 rounded-lg px-4 py-2 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                Delete User
              </button>
              <div className="flex gap-2">
                <button onClick={() => setViewUser(null)} className="btn-ghost text-sm">
                  Close
                </button>
                <button
                  onClick={() => openEdit(viewUser)}
                  className="btn-primary text-sm"
                >
                  Edit Profile
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Add Modal ──────────────────────────────────────────────────── */}
      {showAddModal && (
        <Modal title="Add User" onClose={() => setShowAddModal(false)}>
          <form onSubmit={handleAdd} className="space-y-4">
            <FormRow label="Full Name">
              <input required value={form.name} onChange={e => patch('name', e.target.value)}
                placeholder="Jane Smith" className="input" />
            </FormRow>
            <FormRow label="Email">
              <input required type="email" value={form.email} onChange={e => patch('email', e.target.value)}
                placeholder="jane@company.com" className="input" />
            </FormRow>
            <div className="grid grid-cols-2 gap-3">
              <FormRow label="Role">
                <RoleSelect value={form.role} onChange={v => patch('role', v)} />
              </FormRow>
              <FormRow label="Manager">
                <ManagerSelect value={form.manager_id} managers={managers} onChange={v => patch('manager_id', v)} />
              </FormRow>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormRow label="Country">
                <CountrySelect value={form.country as UserCountry} onChange={v => patch('country', v)} />
              </FormRow>
              <FormRow label="Phone">
                <PhoneInput country={form.country as UserCountry} value={form.phone} onChange={v => patch('phone', v)} />
              </FormRow>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormRow label="Annual Leave (days)">
                <input type="number" min={0} value={form.annual_leave}
                  onChange={e => patch('annual_leave', e.target.value)} className="input" />
              </FormRow>
              <FormRow label="Time-off (hours)">
                <input type="number" min={0} value={form.time_off}
                  onChange={e => patch('time_off', e.target.value)} className="input" />
              </FormRow>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormRow label="Clock-in">
                <input type="time" value={form.reporting_time_in}
                  onChange={e => patch('reporting_time_in', e.target.value)} className="input" />
              </FormRow>
              <FormRow label="Clock-out">
                <input type="time" value={form.reporting_time_out}
                  onChange={e => patch('reporting_time_out', e.target.value)} className="input" />
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

      {/* ── Edit Modal ─────────────────────────────────────────────────── */}
      {editUser && (
        <Modal title={`Edit — ${editUser.name}`} onClose={() => setEditUser(null)}>
          <form onSubmit={handleEdit} className="space-y-4">
            <FormRow label="Full Name">
              <input required value={form.name} onChange={e => patch('name', e.target.value)} className="input" />
            </FormRow>
            <FormRow label="Email">
              <input value={form.email} readOnly className="input bg-gray-50 text-gray-400 cursor-not-allowed" />
            </FormRow>
            <div className="grid grid-cols-2 gap-3">
              <FormRow label="Role">
                <RoleSelect value={form.role} onChange={v => patch('role', v)} />
              </FormRow>
              <FormRow label="Manager">
                <ManagerSelect value={form.manager_id}
                  managers={managers.filter(m => m.id !== editUser.id)}
                  onChange={v => patch('manager_id', v)} />
              </FormRow>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormRow label="Country">
                <CountrySelect value={form.country as UserCountry} onChange={v => patch('country', v)} />
              </FormRow>
              <FormRow label="Phone">
                <PhoneInput country={form.country as UserCountry} value={form.phone} onChange={v => patch('phone', v)} />
              </FormRow>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormRow label="Annual Leave (days)">
                <input type="number" min={0} value={form.annual_leave}
                  onChange={e => patch('annual_leave', e.target.value)} className="input" />
              </FormRow>
              <FormRow label="Time-off (hours)">
                <input type="number" min={0} value={form.time_off}
                  onChange={e => patch('time_off', e.target.value)} className="input" />
              </FormRow>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormRow label="Clock-in">
                <input type="time" value={form.reporting_time_in}
                  onChange={e => patch('reporting_time_in', e.target.value)} className="input" />
              </FormRow>
              <FormRow label="Clock-out">
                <input type="time" value={form.reporting_time_out}
                  onChange={e => patch('reporting_time_out', e.target.value)} className="input" />
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

      {/* ── Set Password ───────────────────────────────────────────────── */}
      {passwordUser && (
        <Modal title="Set Password" onClose={() => setPasswordUser(null)}>
          <div className="flex items-center gap-4 mb-4">
            <div className={`w-14 h-14 rounded-full flex items-center justify-center text-lg font-bold flex-shrink-0 ${avatarBg(passwordUser.role)}`}>
              {initials(passwordUser.name)}
            </div>
            <div>
              <p className="font-semibold text-gray-900">{passwordUser.name}</p>
              <p className="text-sm text-gray-500">{passwordUser.email}</p>
            </div>
          </div>
          <p className="text-xs text-gray-500 mb-4">
            Sets a password this user can sign in with immediately — no magic-link email required.
            Share it with them directly (phone, in person, etc.).
          </p>
          <form onSubmit={handleSetPassword} className="space-y-4">
            <FormRow label="New password">
              <input
                required type="text" autoComplete="new-password"
                value={newPassword} onChange={e => setNewPassword(e.target.value)}
                placeholder="At least 8 characters" className="input font-mono"
              />
            </FormRow>
            <FormRow label="Confirm password">
              <input
                required type="text" autoComplete="new-password"
                value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                placeholder="Repeat the password" className="input font-mono"
              />
            </FormRow>
            {pwMsg && <p className={`text-sm ${pwMsg.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>{pwMsg.text}</p>}
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setPasswordUser(null)} className="btn-ghost">Cancel</button>
              <button type="submit" disabled={settingPassword} className="btn-primary">
                {settingPassword ? 'Setting…' : 'Set Password'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ── Delete Confirm ─────────────────────────────────────────────── */}
      {deleteUser && (
        <Modal title="Delete User" onClose={() => setDeleteUser(null)}>
          <div className="flex items-center gap-4 mb-4">
            <div className={`w-14 h-14 rounded-full flex items-center justify-center text-lg font-bold flex-shrink-0 ${avatarBg(deleteUser.role)}`}>
              {initials(deleteUser.name)}
            </div>
            <div>
              <p className="font-semibold text-gray-900">{deleteUser.name}</p>
              <p className="text-sm text-gray-500">{deleteUser.email}</p>
            </div>
          </div>
          <p className="text-sm text-gray-600 mb-1">
            Are you sure you want to remove <strong>{deleteUser.name}</strong> from this workspace?
          </p>
          <p className="text-xs text-gray-400 mb-5">
            This deletes their account and all associated data. This action cannot be undone.
          </p>
          <div className="flex justify-end gap-3">
            <button onClick={() => setDeleteUser(null)} className="btn-ghost">Cancel</button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="bg-red-600 text-white text-sm font-medium rounded-lg px-4 py-2 hover:bg-red-700 disabled:opacity-50"
            >
              {deleting ? 'Deleting…' : 'Delete User'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ProfileRow({ icon, label, children }: { icon: string; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-5 py-3">
      <span className="text-base w-6 text-center flex-shrink-0">{icon}</span>
      <span className="text-xs font-medium text-gray-400 w-28 flex-shrink-0">{label}</span>
      <span className="text-sm font-medium text-gray-800">{children}</span>
    </div>
  )
}

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
    <select value={value} onChange={e => onChange(e.target.value as UserRole)} className="input">
      {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
    </select>
  )
}

function ManagerSelect({ value, managers, onChange }: { value: string; managers: User[]; onChange: (v: string) => void }) {
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

function PhoneInput({ country, value, onChange }: { country: UserCountry; value: string; onChange: (v: string) => void }) {
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
