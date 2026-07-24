import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import type { SubAccount, Subscription, User } from '@/types'
import type { UserRole } from '@/types'
import { COUNTRY_OPTIONS, PLAN_LABELS } from '@/lib/constants'
import { useAuth } from '@/hooks/useAuth'

interface TimeLog {
  user_id: string
  clock_in: string
  clock_out: string | null
  total_hours: number | null
}

interface Props {
  account: SubAccount
  onClose: () => void
}

interface AddUserForm {
  name: string
  email: string
  role: UserRole
  country: string
  annual_leave: string
  time_off: string
}

interface SettingsForm {
  company_name: string
  admin_email: string
  notes: string
}

const emptyAddUser = (): AddUserForm => ({
  name: '', email: '', role: 'Staff', country: 'SG',
  annual_leave: '14', time_off: '40',
})

const ROLE_COLORS: Record<string, string> = {
  Admin:   'bg-violet-100 text-violet-700',
  Manager: 'bg-blue-100 text-blue-700',
  Staff:   'bg-gray-100 text-gray-600',
}

const PLAN_MRR: Record<string, number> = { free: 0, basic: 19.9, business: 39.9, professional: 99.9 }


type PanelTab = 'overview' | 'users' | 'settings' | 'subscription'

export function SubAccountDetailPanel({ account, onClose }: Props) {
  const { startViewAs } = useAuth()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<PanelTab>('users')
  const [users, setUsers] = useState<User[]>([])
  const [sub, setSub] = useState<Subscription | null>(null)
  const [timeLogs, setTimeLogs] = useState<TimeLog[]>([])
  const [loading, setLoading] = useState(true)

  // User management state
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [newRole, setNewRole] = useState<UserRole>('Staff')
  const [showAddUser, setShowAddUser] = useState(false)
  const [addUserForm, setAddUserForm] = useState<AddUserForm>(emptyAddUser())
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null)

  // Settings state
  const [settingsForm, setSettingsForm] = useState<SettingsForm>({
    company_name: account.company_name,
    admin_email: account.admin_email ?? '',
    notes: account.notes ?? '',
  })

  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Inline subscription change state
  const [subEditPlan, setSubEditPlan] = useState<Subscription['plan'] | null>(null)
  const [subPaymentMode, setSubPaymentMode] = useState<'nil' | 'yes'>('nil')
  const [subSaving, setSubSaving] = useState(false)
  const [subMsg, setSubMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const monthStart = new Date()
    monthStart.setDate(1)
    monthStart.setHours(0, 0, 0, 0)

    const [{ data: usersData }, { data: subData }, { data: logsData }] = await Promise.all([
      supabase
        .from('users')
        .select('id, name, email, role, sub_account, manager_id, country, created_at, annual_leave, time_off, reporting_time_in, reporting_time_out, profile_image, phone, status')
        .eq('sub_account', account.code)
        .order('role'),
      supabase.from('subscriptions').select('*').eq('sub_account', account.code).maybeSingle(),
      supabase.from('time_logs').select('user_id, clock_in, clock_out, total_hours').gte('clock_in', monthStart.toISOString()),
    ])

    setUsers((usersData ?? []) as User[])
    setSub(subData as Subscription | null)

    const userIds = new Set((usersData ?? []).map((u: { id: string }) => u.id))
    setTimeLogs(((logsData ?? []) as TimeLog[]).filter(l => userIds.has(l.user_id)))
    setLoading(false)
  }, [account.code])

  useEffect(() => { void load() }, [load])

  function flash(type: 'success' | 'error', text: string) {
    setMsg({ type, text })
    setTimeout(() => setMsg(null), 3000)
  }

  // ── Role update ────────────────────────────────────────────────────────────
  async function handleRoleUpdate() {
    if (!editingUser) return
    setSaving(true)
    const { error } = await supabase.from('users').update({ role: newRole }).eq('id', editingUser.id)
    setSaving(false)
    if (error) { flash('error', error.message); return }
    flash('success', `${editingUser.name}'s role updated to ${newRole}.`)
    setEditingUser(null)
    void load()
  }

  // ── Add user ───────────────────────────────────────────────────────────────
  async function handleAddUser(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    const { error } = await supabase.from('users').insert({
      email: addUserForm.email.toLowerCase().trim(),
      name: addUserForm.name.trim(),
      role: addUserForm.role,
      sub_account: account.code,
      country: addUserForm.country,
      annual_leave: Number(addUserForm.annual_leave),
      time_off: Number(addUserForm.time_off),
      reporting_time_in: '09:00',
      reporting_time_out: '18:00',
    })
    setSaving(false)
    if (error) { flash('error', error.message); return }
    flash('success', `${addUserForm.name} added successfully. They can now log in with their email.`)
    setShowAddUser(false)
    setAddUserForm(emptyAddUser())
    void load()
  }

  // ── View As ────────────────────────────────────────────────────────────────
  function handleViewAs(u: User) {
    startViewAs(u)
    onClose()
    navigate('/')
  }

  // ── Delete user ────────────────────────────────────────────────────────────
  async function handleDeleteUser(userId: string, userName: string) {
    if (!confirm(`Remove ${userName} from this sub-account? This cannot be undone.`)) return
    setDeletingUserId(userId)
    const { error } = await supabase.from('users').delete().eq('id', userId)
    setDeletingUserId(null)
    if (error) { flash('error', error.message); return }
    flash('success', `${userName} removed.`)
    void load()
  }

  // ── Settings save ──────────────────────────────────────────────────────────
  async function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    const { error } = await supabase
      .from('sub_accounts')
      .update({
        company_name: settingsForm.company_name.trim(),
        admin_email: settingsForm.admin_email.toLowerCase().trim(),
        notes: settingsForm.notes.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq('code', account.code)
    setSaving(false)
    if (error) { flash('error', error.message); return }
    flash('success', 'Account settings saved.')
  }

  const hoursThisMonth = timeLogs.reduce((acc, l) => acc + (l.total_hours ?? 0), 0)
  const activeNow = timeLogs.filter(l => !l.clock_out).length

  const TAB_LABELS: Record<PanelTab, string> = {
    overview: 'Overview',
    users: 'Users',
    settings: 'Settings',
    subscription: 'Subscription',
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />

      {/* Slide-over panel */}
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-2xl bg-white shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-5 border-b border-gray-100 bg-gradient-to-r from-violet-50 to-white">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <span className="font-mono text-sm font-bold bg-violet-100 text-violet-800 px-2.5 py-1 rounded-lg">{account.code}</span>
              <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full capitalize ${
                account.status === 'active' ? 'bg-emerald-100 text-emerald-700' :
                account.status === 'trialing' ? 'bg-amber-100 text-amber-700' :
                'bg-red-100 text-red-600'
              }`}>{account.status}</span>
              <span className="text-xs text-violet-500 font-medium bg-violet-50 border border-violet-100 px-2 py-0.5 rounded-full">Visiting</span>
            </div>
            <h2 className="text-xl font-bold text-gray-900">{account.company_name || account.code}</h2>
            {account.admin_email && <p className="text-sm text-gray-500 mt-0.5">{account.admin_email}</p>}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none mt-1">&times;</button>
        </div>

        {/* Tabs */}
        <div className="flex gap-6 px-6 border-b border-gray-100">
          {(['overview', 'users', 'settings', 'subscription'] as PanelTab[]).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab ? 'border-violet-600 text-violet-600' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {TAB_LABELS[tab]}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center h-40">
              <div className="w-6 h-6 border-4 border-violet-600 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <>
              {msg && (
                <div className={`mb-4 rounded-lg px-4 py-2.5 text-sm ${msg.type === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                  {msg.text}
                </div>
              )}

              {/* OVERVIEW TAB */}
              {activeTab === 'overview' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-3">
                    <MiniStat label="Total Users" value={String(users.length)} sub={`of ${account.seats} seats`} />
                    <MiniStat label="Active Now" value={String(activeNow)} sub="clocked in" />
                    <MiniStat label="Hours (MTD)" value={hoursThisMonth.toFixed(1)} sub="this month" />
                  </div>

                  <div className="bg-gray-50 rounded-xl p-4">
                    <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Account Details</h4>
                    <dl className="space-y-2 text-sm">
                      <Row label="Plan" value={<span className="font-semibold text-violet-700">{PLAN_LABELS[account.plan] ?? account.plan}</span>} />
                      <Row label="Seats used" value={`${users.length} / ${account.seats}`} />
                      <Row label="Monthly value" value={`$${PLAN_MRR[account.plan]?.toFixed(2) ?? '0.00'}`} />
                      <Row label="Admin email" value={account.admin_email ?? '—'} />
                      <Row label="Created" value={new Date(account.created_at).toLocaleDateString('en-SG', { year: 'numeric', month: 'long', day: 'numeric' })} />
                      {account.notes && <Row label="Notes" value={account.notes} />}
                    </dl>
                  </div>

                  <div className="bg-gray-50 rounded-xl p-4">
                    <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Users by Role</h4>
                    <div className="space-y-2">
                      {(['Admin', 'Manager', 'Staff'] as UserRole[]).map(role => {
                        const count = users.filter(u => u.role === role).length
                        return (
                          <div key={role} className="flex items-center justify-between">
                            <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${ROLE_COLORS[role]}`}>{role}</span>
                            <span className="text-sm font-bold text-gray-700">{count}</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* USERS TAB */}
              {activeTab === 'users' && (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm text-gray-500">{users.length} user{users.length !== 1 ? 's' : ''} · {account.seats - users.length} seat{account.seats - users.length !== 1 ? 's' : ''} available</p>
                    <button
                      onClick={() => { setAddUserForm(emptyAddUser()); setShowAddUser(true) }}
                      className="flex items-center gap-1.5 text-xs font-semibold bg-violet-600 text-white px-3 py-1.5 rounded-lg hover:bg-violet-700 transition-colors"
                    >
                      <span className="text-sm leading-none">+</span> Add User
                    </button>
                  </div>
                  <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 border-b border-gray-100">
                        <tr>
                          <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Name</th>
                          <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Email</th>
                          <th className="text-center px-4 py-3 text-xs font-medium text-gray-500">Role</th>
                          <th className="text-center px-4 py-3 text-xs font-medium text-gray-500">Country</th>
                          <th className="text-center px-4 py-3 text-xs font-medium text-indigo-500">View As</th>
                          <th className="text-right px-4 py-3 text-xs font-medium text-gray-500">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {users.length === 0 && (
                          <tr><td colSpan={5} className="text-center py-8 text-gray-400 text-sm">No users in this account. Add one to get started.</td></tr>
                        )}
                        {users.map(u => (
                          <tr key={u.id} className="hover:bg-gray-50 transition-colors">
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <div className="w-7 h-7 rounded-full bg-violet-100 text-violet-700 text-xs font-bold flex items-center justify-center flex-shrink-0">
                                  {u.name.slice(0, 2).toUpperCase()}
                                </div>
                                <span className="font-medium text-gray-900">{u.name}</span>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-gray-500 text-xs">{u.email}</td>
                            <td className="px-4 py-3 text-center">
                              {editingUser?.id === u.id ? (
                                <div className="flex items-center gap-2 justify-center">
                                  <select
                                    value={newRole}
                                    onChange={e => setNewRole(e.target.value as UserRole)}
                                    className="border border-gray-300 rounded text-xs px-2 py-1"
                                  >
                                    {(['Admin', 'Manager', 'Staff'] as UserRole[]).map(r => (
                                      <option key={r} value={r}>{r}</option>
                                    ))}
                                  </select>
                                  <button onClick={handleRoleUpdate} disabled={saving} className="text-xs text-violet-600 font-medium hover:text-violet-800">
                                    {saving ? '…' : '✓'}
                                  </button>
                                  <button onClick={() => setEditingUser(null)} className="text-xs text-gray-400 hover:text-gray-600">✕</button>
                                </div>
                              ) : (
                                <span className={`inline-block text-xs font-semibold px-2.5 py-0.5 rounded-full ${ROLE_COLORS[u.role] ?? 'bg-gray-100 text-gray-600'}`}>
                                  {u.role}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-center text-xs text-gray-500">{u.country || '—'}</td>
                            <td className="px-4 py-3 text-center">
                              <button
                                onClick={() => handleViewAs(u)}
                                title={`View app as ${u.name}`}
                                className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 px-2.5 py-1 rounded-lg transition-colors"
                              >
                                👁 View As
                              </button>
                            </td>
                            <td className="px-4 py-3 text-right">
                              {editingUser?.id !== u.id && (
                                <div className="flex items-center justify-end gap-2">
                                  <button
                                    onClick={() => { setEditingUser(u); setNewRole(u.role) }}
                                    className="text-xs text-violet-600 hover:text-violet-800 font-medium"
                                  >
                                    Role
                                  </button>
                                  <button
                                    onClick={() => handleDeleteUser(u.id, u.name)}
                                    disabled={deletingUserId === u.id}
                                    className="text-xs text-red-500 hover:text-red-700 font-medium disabled:opacity-40"
                                  >
                                    {deletingUserId === u.id ? '…' : 'Remove'}
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* SETTINGS TAB */}
              {activeTab === 'settings' && (
                <form onSubmit={handleSaveSettings} className="space-y-5">
                  <div className="bg-gray-50 rounded-xl p-5 border border-gray-200">
                    <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4">Account Details</h4>
                    <div className="space-y-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Company Name</label>
                        <input
                          required
                          value={settingsForm.company_name}
                          onChange={e => setSettingsForm(f => ({ ...f, company_name: e.target.value }))}
                          className="input"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Admin Email</label>
                        <input
                          type="email"
                          value={settingsForm.admin_email}
                          onChange={e => setSettingsForm(f => ({ ...f, admin_email: e.target.value }))}
                          placeholder="admin@company.com"
                          className="input"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Internal Notes</label>
                        <textarea
                          rows={2}
                          value={settingsForm.notes}
                          onChange={e => setSettingsForm(f => ({ ...f, notes: e.target.value }))}
                          placeholder="Internal notes about this account…"
                          className="input resize-none"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="bg-gray-50 rounded-xl p-5 border border-gray-200">
                    <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Account Info (read-only)</h4>
                    <dl className="space-y-2 text-sm">
                      <Row label="Sub-Account Code" value={<span className="font-mono font-bold text-gray-800">{account.code}</span>} />
                      <Row label="Plan" value={<span className="font-semibold text-violet-700">{PLAN_LABELS[account.plan] ?? account.plan}</span>} />
                      <Row label="Seats" value={`${users.length} used / ${account.seats} total`} />
                      <Row label="Status" value={<span className="capitalize">{account.status}</span>} />
                      <Row label="Created" value={new Date(account.created_at).toLocaleDateString('en-SG', { year: 'numeric', month: 'long', day: 'numeric' })} />
                    </dl>
                    <p className="text-xs text-gray-400 mt-3 pt-3 border-t border-gray-200">
                      To change plan, seats, or status — use the Edit button in the Sub-Accounts list or the Subscriptions tab.
                    </p>
                  </div>

                  <div className="flex justify-end">
                    <button type="submit" disabled={saving} className="btn-primary">
                      {saving ? 'Saving…' : 'Save Settings'}
                    </button>
                  </div>
                </form>
              )}

              {/* SUBSCRIPTION TAB */}
              {activeTab === 'subscription' && (
                <div className="space-y-4">
                  {sub ? (
                    <>
                      <div className="bg-white rounded-xl border border-gray-200 p-5">
                        <h4 className="text-sm font-semibold text-gray-700 mb-3">Current Subscription</h4>
                        <dl className="space-y-2 text-sm">
                          <Row label="Plan" value={<span className="font-semibold text-violet-700">{PLAN_LABELS[sub.plan] ?? sub.plan}</span>} />
                          <Row label="Payment" value={
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${sub.status === 'trialing' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>
                              {sub.status === 'trialing' ? 'YES — trial active' : 'NIL — no payment required'}
                            </span>
                          } />
                          <Row label="Status" value={
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${
                              sub.status === 'active' ? 'bg-emerald-100 text-emerald-700' :
                              sub.status === 'trialing' ? 'bg-amber-100 text-amber-700' :
                              'bg-red-100 text-red-600'
                            }`}>{sub.status}</span>
                          } />
                          <Row label="Seats" value={String(sub.seats)} />
                          <Row label="Billing cycle" value={<span className="capitalize">{sub.billing_cycle ?? 'monthly'}</span>} />
                          <Row label="MRR value" value={`$${PLAN_MRR[sub.plan]?.toFixed(2) ?? '0.00'}/mo`} />
                          {sub.billing_date && (
                            <Row label="Trial ends / Next billing" value={new Date(sub.billing_date).toLocaleDateString('en-SG', { year: 'numeric', month: 'long', day: 'numeric' })} />
                          )}
                          {sub.notes && <Row label="Notes" value={sub.notes} />}
                        </dl>
                      </div>

                      {/* Change Plan & Payment */}
                      <div className="bg-violet-50 rounded-xl border border-violet-200 p-5">
                        <h4 className="text-sm font-semibold text-gray-800 mb-4">Change Plan &amp; Payment</h4>
                        <div className="space-y-4">
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1.5">Subscription Plan</label>
                            <select
                              value={subEditPlan ?? sub.plan}
                              onChange={e => setSubEditPlan(e.target.value as Subscription['plan'])}
                              className="input text-sm"
                            >
                              <option value="free">Free</option>
                              <option value="basic">Standard</option>
                              <option value="business">Business</option>
                              <option value="professional">Professional</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-2">Payment Required</label>
                            <div className="flex gap-6">
                              <label className="flex items-start gap-2 cursor-pointer">
                                <input type="radio" name="sub_payment" checked={subPaymentMode === 'nil'} onChange={() => setSubPaymentMode('nil')} className="mt-0.5 accent-violet-600" />
                                <div>
                                  <p className="text-sm font-medium text-gray-800">NIL</p>
                                  <p className="text-xs text-gray-500">Active immediately, no payment needed</p>
                                </div>
                              </label>
                              <label className="flex items-start gap-2 cursor-pointer">
                                <input type="radio" name="sub_payment" checked={subPaymentMode === 'yes'} onChange={() => setSubPaymentMode('yes')} className="mt-0.5 accent-violet-600" />
                                <div>
                                  <p className="text-sm font-medium text-gray-800">YES</p>
                                  <p className="text-xs text-gray-500">14-day trial then payment required</p>
                                </div>
                              </label>
                            </div>
                          </div>
                          {subMsg && <p className={`text-sm ${subMsg.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>{subMsg.text}</p>}
                          <button
                            disabled={subSaving}
                            onClick={async () => {
                              setSubSaving(true); setSubMsg(null)
                              const newPlan = subEditPlan ?? sub.plan
                              const newStatus: Subscription['status'] = subPaymentMode === 'yes' ? 'trialing' : 'active'
                              let newBillingDate: string | null = null
                              if (subPaymentMode === 'yes') {
                                const trial = new Date(); trial.setDate(trial.getDate() + 14)
                                newBillingDate = trial.toISOString().split('T')[0]
                              }
                              const { error: e1 } = await supabase.from('subscriptions').update({ plan: newPlan, status: newStatus, billing_date: newBillingDate }).eq('id', sub.id)
                              const { error: e2 } = await supabase.from('sub_accounts').update({ plan: newPlan, status: newStatus }).eq('code', account.code)
                              setSubSaving(false)
                              if (e1 || e2) { setSubMsg({ type: 'error', text: (e1 ?? e2)!.message }) }
                              else { setSubMsg({ type: 'success', text: `Plan updated to ${PLAN_LABELS[newPlan] ?? newPlan} · Payment: ${subPaymentMode.toUpperCase()}` }); void load() }
                            }}
                            className="btn-primary text-sm"
                          >
                            {subSaving ? 'Saving…' : 'Apply Plan Change'}
                          </button>
                        </div>
                      </div>

                      <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Billing History</h4>
                        <div className="space-y-2">
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-600">Account created</span>
                            <span className="font-medium text-gray-800">
                              {new Date(sub.created_at).toLocaleDateString('en-SG', { year: 'numeric', month: 'long', day: 'numeric' })}
                            </span>
                          </div>
                        </div>
                        <p className="text-xs text-gray-400 mt-3 pt-2 border-t border-gray-200">
                          Full invoice history will appear here once Stripe integration is enabled.
                        </p>
                      </div>
                    </>
                  ) : (
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 text-sm text-amber-800">
                      No subscription record found for this sub-account.
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Add User Modal */}
      {showAddUser && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div>
                <h3 className="font-semibold text-gray-900">Add User</h3>
                <p className="text-xs text-gray-500 mt-0.5">Adding to <span className="font-mono font-bold">{account.code}</span> · {account.company_name}</p>
              </div>
              <button onClick={() => setShowAddUser(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
            </div>
            <form onSubmit={handleAddUser} className="px-6 py-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                <input
                  required
                  value={addUserForm.name}
                  onChange={e => setAddUserForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="John Smith"
                  className="input"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email Address</label>
                <input
                  required
                  type="email"
                  value={addUserForm.email}
                  onChange={e => setAddUserForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="john@company.com"
                  className="input"
                />
                <p className="text-xs text-gray-400 mt-0.5">User will log in via magic link sent to this email.</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                  <select
                    value={addUserForm.role}
                    onChange={e => setAddUserForm(f => ({ ...f, role: e.target.value as UserRole }))}
                    className="input"
                  >
                    {(['Admin', 'Manager', 'Staff'] as UserRole[]).map(r => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Country</label>
                  <select
                    value={addUserForm.country}
                    onChange={e => setAddUserForm(f => ({ ...f, country: e.target.value }))}
                    className="input"
                  >
                    {COUNTRY_OPTIONS.map(c => (
                      <option key={c.code} value={c.code}>{c.flag} {c.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Annual Leave (days)</label>
                  <input
                    type="number"
                    min={0}
                    max={60}
                    value={addUserForm.annual_leave}
                    onChange={e => setAddUserForm(f => ({ ...f, annual_leave: e.target.value }))}
                    className="input"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Time Off (hours)</label>
                  <input
                    type="number"
                    min={0}
                    value={addUserForm.time_off}
                    onChange={e => setAddUserForm(f => ({ ...f, time_off: e.target.value }))}
                    className="input"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowAddUser(false)} className="btn-ghost">Cancel</button>
                <button type="submit" disabled={saving} className="btn-primary">
                  {saving ? 'Adding…' : 'Add User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}

function MiniStat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      <p className="text-xs font-medium text-gray-700 mt-0.5">{label}</p>
      <p className="text-xs text-gray-400">{sub}</p>
    </div>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between items-center">
      <dt className="text-gray-500">{label}</dt>
      <dd className="font-medium text-gray-800">{value}</dd>
    </div>
  )
}
