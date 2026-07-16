import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { PLAN_LABELS } from '@/lib/constants'

interface DashStats {
  totalAccounts: number
  activeAccounts: number
  trialingAccounts: number
  suspendedAccounts: number
  totalUsers: number
  clockedInNow: number
  mrr: number
  annualRun: number
  planDist: Record<string, number>
  recentAccounts: { code: string; company_name: string; plan: string; status: string; created_at: string }[]
  topAccounts: { code: string; company_name: string; userCount: number; plan: string }[]
}

const PLAN_MRR: Record<string, number> = { free: 0, basic: 19.9, business: 39.9, professional: 99.9 }

const PLAN_COLORS: Record<string, string> = {
  free: 'bg-gray-400',
  basic: 'bg-blue-500',
  business: 'bg-violet-500',
  professional: 'bg-amber-500',
}
const PLAN_TEXT: Record<string, string> = {
  free: 'text-gray-600',
  basic: 'text-blue-700',
  business: 'text-violet-700',
  professional: 'text-amber-700',
}

export function PlatformDashboard() {
  const [stats, setStats] = useState<DashStats | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    const [{ data: accounts }, { data: subs }, { data: users }, { data: active }] = await Promise.all([
      supabase.from('sub_accounts').select('code, company_name, plan, status, created_at').neq('code', '__saas__'),
      supabase.from('subscriptions').select('sub_account, plan, status').neq('sub_account', '__saas__'),
      supabase.from('users').select('id, sub_account').neq('sub_account', '__saas__'),
      supabase.from('time_logs').select('user_id').gte('clock_in', todayStart.toISOString()).is('clock_out', null),
    ])

    const accs = accounts ?? []
    const subsData = subs ?? []
    const usersData = users ?? []
    const activeData = active ?? []

    const planDist: Record<string, number> = { free: 0, basic: 0, business: 0, professional: 0 }
    let mrr = 0
    for (const s of subsData) {
      if (s.status === 'active' || s.status === 'trialing') {
        planDist[s.plan] = (planDist[s.plan] ?? 0) + 1
        if (s.status === 'active') mrr += PLAN_MRR[s.plan] ?? 0
      }
    }

    const userCountByAccount: Record<string, number> = {}
    for (const u of usersData) userCountByAccount[u.sub_account] = (userCountByAccount[u.sub_account] ?? 0) + 1

    const topAccounts = [...accs]
      .sort((a, b) => (userCountByAccount[b.code] ?? 0) - (userCountByAccount[a.code] ?? 0))
      .slice(0, 5)
      .map(a => ({ code: a.code, company_name: a.company_name, plan: a.plan, userCount: userCountByAccount[a.code] ?? 0 }))

    setStats({
      totalAccounts: accs.length,
      activeAccounts: accs.filter(a => a.status === 'active').length,
      trialingAccounts: accs.filter(a => a.status === 'trialing').length,
      suspendedAccounts: accs.filter(a => a.status === 'suspended' || a.status === 'cancelled').length,
      totalUsers: usersData.length,
      clockedInNow: activeData.length,
      mrr,
      annualRun: mrr * 12,
      planDist,
      recentAccounts: [...accs].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 5),
      topAccounts,
    })
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-violet-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!stats) return null

  const totalPaid = stats.planDist.basic + stats.planDist.business + stats.planDist.professional
  const totalTracked = totalPaid + stats.planDist.free

  return (
    <div className="space-y-6">

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Monthly Revenue"
          value={`$${stats.mrr.toFixed(2)}`}
          sub={`$${stats.annualRun.toFixed(0)} ARR`}
          color="text-emerald-700"
          icon="💰"
          bg="bg-emerald-50"
        />
        <StatCard
          label="Sub-Accounts"
          value={String(stats.totalAccounts)}
          sub={`${stats.activeAccounts} active · ${stats.trialingAccounts} trialing`}
          color="text-violet-700"
          icon="🏢"
          bg="bg-violet-50"
        />
        <StatCard
          label="Total Users"
          value={String(stats.totalUsers)}
          sub={`${stats.clockedInNow} clocked in now`}
          color="text-blue-700"
          icon="👥"
          bg="bg-blue-50"
        />
        <StatCard
          label="Paid Accounts"
          value={String(totalPaid)}
          sub={`${stats.totalAccounts > 0 ? Math.round((totalPaid / stats.totalAccounts) * 100) : 0}% conversion`}
          color="text-amber-700"
          icon="⭐"
          bg="bg-amber-50"
        />
      </div>

      {/* Mid row: Plan Distribution + Account Status + Clocked In */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Plan Distribution */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Plan Distribution</h3>
          <div className="space-y-3">
            {(['professional', 'business', 'basic', 'free'] as const).map(plan => (
              <div key={plan}>
                <div className="flex justify-between text-xs text-gray-600 mb-1">
                  <span className={`font-medium ${PLAN_TEXT[plan]}`}>{PLAN_LABELS[plan] ?? plan}</span>
                  <span className="font-bold text-gray-800">{stats.planDist[plan] ?? 0}</span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${PLAN_COLORS[plan]}`}
                    style={{ width: `${totalTracked > 0 ? Math.max(2, ((stats.planDist[plan] ?? 0) / totalTracked) * 100) : 0}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-3 border-t border-gray-100 flex justify-between text-xs text-gray-500">
            <span>{totalPaid} paid</span>
            <span>{stats.planDist.free} free</span>
          </div>
        </div>

        {/* Account Status Donut (CSS) */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Account Health</h3>
          <div className="space-y-2">
            {[
              { label: 'Active', count: stats.activeAccounts, color: 'bg-emerald-500', text: 'text-emerald-700' },
              { label: 'Trialing', count: stats.trialingAccounts, color: 'bg-amber-400', text: 'text-amber-700' },
              { label: 'Cancelled / Suspended', count: stats.suspendedAccounts, color: 'bg-red-400', text: 'text-red-600' },
            ].map(row => (
              <div key={row.label} className="flex items-center gap-3">
                <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${row.color}`} />
                <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${row.color}`}
                    style={{ width: `${stats.totalAccounts > 0 ? Math.max(2, (row.count / stats.totalAccounts) * 100) : 0}%` }}
                  />
                </div>
                <div className="flex items-center gap-2 min-w-[5rem]">
                  <span className={`text-xs font-semibold ${row.text}`}>{row.count}</span>
                  <span className="text-xs text-gray-400">{row.label}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-3 border-t border-gray-100">
            <p className="text-xs text-gray-500">
              {stats.totalAccounts > 0
                ? `${Math.round((stats.activeAccounts / stats.totalAccounts) * 100)}% accounts active`
                : 'No accounts yet'}
            </p>
          </div>
        </div>

        {/* Live Activity */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Live Activity</h3>
          <div className="flex flex-col items-center justify-center h-28">
            <div className="relative flex items-center justify-center w-20 h-20">
              <div className="absolute inset-0 rounded-full border-4 border-gray-100" />
              <div
                className="absolute inset-0 rounded-full border-4 border-emerald-500"
                style={{
                  clipPath: stats.totalUsers > 0
                    ? `polygon(50% 50%, 50% 0%, ${50 + 50 * Math.sin(2 * Math.PI * (stats.clockedInNow / stats.totalUsers))}% ${50 - 50 * Math.cos(2 * Math.PI * (stats.clockedInNow / stats.totalUsers))}%, 50% 50%)`
                    : 'none',
                }}
              />
              <span className="text-xl font-bold text-emerald-700">{stats.clockedInNow}</span>
            </div>
            <p className="text-xs text-gray-500 mt-2">users clocked in today</p>
            <p className="text-xs text-gray-400">{stats.totalUsers} total users</p>
          </div>
          <div className="mt-2 pt-3 border-t border-gray-100">
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full bg-emerald-500"
                style={{ width: `${stats.totalUsers > 0 ? Math.max(0, (stats.clockedInNow / stats.totalUsers) * 100) : 0}%` }}
              />
            </div>
            <p className="text-xs text-gray-400 mt-1">
              {stats.totalUsers > 0 ? `${Math.round((stats.clockedInNow / stats.totalUsers) * 100)}%` : '0%'} active now
            </p>
          </div>
        </div>
      </div>

      {/* Bottom row: Recent + Top Accounts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Recent Sign-ups */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Recent Sign-ups</h3>
          {stats.recentAccounts.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">No sub-accounts yet</p>
          ) : (
            <div className="divide-y divide-gray-50">
              {stats.recentAccounts.map(a => (
                <div key={a.code} className="flex items-center justify-between py-2.5">
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-xs font-bold bg-gray-100 text-gray-700 px-2 py-0.5 rounded">{a.code}</span>
                    <span className="text-sm text-gray-700">{a.company_name || a.code}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${PLAN_TEXT[a.plan]} bg-opacity-10`}
                      style={{ background: 'rgb(var(--color-bg, 240 240 240))' }}>
                      {PLAN_LABELS[a.plan] ?? a.plan}
                    </span>
                    <span className="text-xs text-gray-400">
                      {new Date(a.created_at).toLocaleDateString('en-SG', { month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Top Accounts by Users */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Top Accounts by Users</h3>
          {stats.topAccounts.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">No data yet</p>
          ) : (
            <div className="space-y-2.5">
              {stats.topAccounts.map((a, i) => (
                <div key={a.code} className="flex items-center gap-3">
                  <span className="text-xs font-bold text-gray-400 w-4">{i + 1}</span>
                  <div className="flex-1">
                    <div className="flex justify-between text-xs text-gray-600 mb-1">
                      <span className="font-medium text-gray-800">{a.company_name || a.code}</span>
                      <span className="font-bold">{a.userCount}</span>
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${PLAN_COLORS[a.plan]}`}
                        style={{ width: `${stats.topAccounts[0].userCount > 0 ? (a.userCount / stats.topAccounts[0].userCount) * 100 : 0}%` }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

    </div>
  )
}

function StatCard({ label, value, sub, color, icon, bg }: {
  label: string; value: string; sub: string; color: string; icon: string; bg: string
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-start justify-between mb-3">
        <p className="text-xs font-medium text-gray-500">{label}</p>
        <span className={`text-lg p-1.5 rounded-lg ${bg}`}>{icon}</span>
      </div>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      <p className="text-xs text-gray-400 mt-0.5">{sub}</p>
    </div>
  )
}
