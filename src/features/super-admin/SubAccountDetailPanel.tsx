import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import type { SubAccount, Subscription } from '@/types'
import type { UserRole } from '@/types'

interface User {
  id: string
  name: string
  email: string
  role: UserRole
  country: string
  created_at: string
}

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

const ROLE_COLORS: Record<string, string> = {
  Admin:   'bg-violet-100 text-violet-700',
  Manager: 'bg-blue-100 text-blue-700',
  Staff:   'bg-gray-100 text-gray-600',
}

const PLAN_MRR: Record<string, number> = { free: 0, basic: 19.9, business: 39.9, professional: 99.9 }

type PanelTab = 'overview' | 'users' | 'subscription'

export function SubAccountDetailPanel({ account, onClose }: Props) {
  const [activeTab, setActiveTab] = useState<PanelTab>('overview')
  const [users, setUsers] = useState<User[]>([])
  const [sub, setSub] = useState<Subscription | null>(null)
  const [timeLogs, setTimeLogs] = useState<TimeLog[]>([])
  const [loading, setLoading] = useState(true)
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [newRole, setNewRole] = useState<UserRole>('Staff')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const monthStart = new Date()
    monthStart.setDate(1)
    monthStart.setHours(0, 0, 0, 0)

    const [{ data: usersData }, { data: subData }, { data: logsData }] = await Promise.all([
      supabase.from('users').select('id, name, email, role, country, created_at').eq('sub_account', account.code).order('role'),
      supabase.from('subscriptions').select('*').eq('sub_account', account.code).maybeSingle(),
      supabase.from('time_logs').select('user_id, clock_in, clock_out, total_hours').gte('clock_in', monthStart.toISOString()),
    ])

    setUsers((usersData ?? []) as User[])
    setSub(subData as Subscription | null)

    const userIds = new Set((usersData ?? []).map((u: User) => u.id))
    setTimeLogs(((logsData ?? []) as TimeLog[]).filter(l => userIds.has(l.user_id)))
    setLoading(false)
  }, [account.code])

  useEffect(() => { void load() }, [load])

  async function handleRoleUpdate() {
    if (!editingUser) return
    setSaving(true)
    const { error } = await supabase.from('users').update({ role: newRole }).eq('id', editingUser.id)
    setSaving(false)
    if (error) { setMsg({ type: 'error', text: error.message }); return }
    setMsg({ type: 'success', text: `${editingUser.name}'s role updated to ${newRole}.` })
    setEditingUser(null)
    void load()
    setTimeout(() => setMsg(null), 3000)
  }

  const hoursThisMonth = timeLogs.reduce((acc, l) => acc + (l.total_hours ?? 0), 0)
  const activeNow = timeLogs.filter(l => !l.clock_out).length

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
            </div>
            <h2 className="text-xl font-bold text-gray-900">{account.company_name || account.code}</h2>
            {account.admin_email && <p className="text-sm text-gray-500 mt-0.5">{account.admin_email}</p>}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none mt-1">&times;</button>
        </div>

        {/* Tabs */}
        <div className="flex gap-6 px-6 border-b border-gray-100">
          {(['overview', 'users', 'subscription'] as PanelTab[]).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`py-3 text-sm font-medium border-b-2 transition-colors capitalize ${
                activeTab === tab ? 'border-violet-600 text-violet-600' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab}
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
                      <Row label="Plan" value={
                        <span className="capitalize font-semibold text-violet-700">{account.plan}</span>
                      } />
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
                    <p className="text-sm text-gray-500">{users.length} user{users.length !== 1 ? 's' : ''}</p>
                  </div>
                  <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 border-b border-gray-100">
                        <tr>
                          <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Name</th>
                          <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Email</th>
                          <th className="text-center px-4 py-3 text-xs font-medium text-gray-500">Role</th>
                          <th className="text-right px-4 py-3 text-xs font-medium text-gray-500">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {users.length === 0 && (
                          <tr><td colSpan={4} className="text-center py-8 text-gray-400 text-sm">No users in this account.</td></tr>
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
                            <td className="px-4 py-3 text-right">
                              {editingUser?.id !== u.id && (
                                <button
                                  onClick={() => { setEditingUser(u); setNewRole(u.role) }}
                                  className="text-xs text-violet-600 hover:text-violet-800 font-medium"
                                >
                                  Change Role
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* SUBSCRIPTION TAB */}
              {activeTab === 'subscription' && (
                <div className="space-y-4">
                  {sub ? (
                    <>
                      <div className="bg-white rounded-xl border border-gray-200 p-5">
                        <h4 className="text-sm font-semibold text-gray-700 mb-3">Current Subscription</h4>
                        <dl className="space-y-2 text-sm">
                          <Row label="Plan" value={<span className="capitalize font-semibold text-violet-700">{sub.plan}</span>} />
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
                            <Row label="Next billing" value={new Date(sub.billing_date).toLocaleDateString('en-SG', { year: 'numeric', month: 'long', day: 'numeric' })} />
                          )}
                          {sub.notes && <Row label="Notes" value={sub.notes} />}
                        </dl>
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
                          {sub.plan !== 'free' && (
                            <div className="flex justify-between text-sm">
                              <span className="text-gray-600">Current plan since</span>
                              <span className="font-medium text-gray-800">
                                {new Date(sub.created_at).toLocaleDateString('en-SG', { year: 'numeric', month: 'long', day: 'numeric' })}
                              </span>
                            </div>
                          )}
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
