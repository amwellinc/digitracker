import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import { todayInTz, DEFAULT_TIMEZONE } from '@/lib/timezone'
import { useRealtime } from '@/hooks/useRealtime'
import { Avatar } from '@/components/ui/Avatar'
import { UserActivityDrawer } from '@/features/time-tracking/UserActivityDrawer'
import type { User, LeaveRequest, Screenshot, TimeLog } from '@/types'

// ─── Types ──────────────────────────────────────────────────────────────────
type WorkStatus = 'working' | 'lunch' | 'absent'

interface MemberRow extends User {
  workStatus: WorkStatus
  clockIn: string | null
  hoursToday: number
}

interface PendingLeave extends LeaveRequest {
  userName: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function fmtHours(mins: number) {
  const h = Math.floor(mins / 60)
  const m = Math.floor(mins % 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

function useLiveClock() {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return now
}

// ─── Status Badge ─────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: WorkStatus }) {
  const map = {
    working: 'bg-green-100 text-green-700',
    lunch:   'bg-amber-100 text-amber-700',
    absent:  'bg-gray-100 text-gray-500',
  }
  const label = { working: 'Online', lunch: 'On Lunch', absent: 'Offline' }
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-0.5 rounded-full ${map[status]}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${status === 'working' ? 'bg-green-500' : status === 'lunch' ? 'bg-amber-400' : 'bg-gray-400'}`} />
      {label[status]}
    </span>
  )
}

// ─── Stat Card ────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, accent }: { label: string; value: number | string; sub?: string; accent?: string }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 px-5 py-4 flex flex-col gap-1">
      <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</span>
      <span className={`text-3xl font-extrabold ${accent ?? 'text-gray-900'}`}>{value}</span>
      {sub && <span className="text-xs text-gray-400">{sub}</span>}
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────
export function AdminDashboard() {
  const { user } = useAuth()
  const now = useLiveClock()

  const [members, setMembers] = useState<MemberRow[]>([])
  const [pending, setPending] = useState<PendingLeave[]>([])
  const [shots, setShots] = useState<Screenshot[]>([])
  const [lightbox, setLightbox] = useState<Screenshot | null>(null)
  const [selected, setSelected] = useState<(User & { isOnline: boolean }) | null>(null)
  const [actioning, setActioning] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!user) return
    const today = todayInTz(DEFAULT_TIMEZONE)

    // All users in workspace
    const { data: usersData } = await supabase
      .from('users')
      .select('*')
      .eq('sub_account', user.sub_account)
      .order('name')

    const allUsers = (usersData ?? []) as User[]
    const userIds = allUsers.map(u => u.id)

    // Today's time logs
    const { data: logsData } = await supabase
      .from('time_logs')
      .select('*')
      .eq('date', today)
      .in('user_id', userIds)

    const logs = (logsData ?? []) as TimeLog[]

    // Map to MemberRow
    const rows: MemberRow[] = allUsers.map(u => {
      const userLogs = logs.filter(l => l.user_id === u.id)
      const activeLog = userLogs.find(l => l.status === 'working' || l.status === 'lunch')
      const totalMins = userLogs.reduce((s, l) => s + (l.total_minutes ?? 0), 0)

      // Add running minutes for active session
      let runningMins = 0
      if (activeLog?.status === 'working') {
        runningMins = (Date.now() - new Date(activeLog.clock_in).getTime()) / 60000
      }

      return {
        ...u,
        workStatus: activeLog ? (activeLog.status as WorkStatus) : 'absent',
        clockIn: activeLog?.clock_in ?? null,
        hoursToday: Math.round(totalMins + runningMins),
      }
    })

    setMembers(rows)

    // Pending leave requests
    const { data: leaveData } = await supabase
      .from('leave_requests')
      .select('*')
      .eq('status', 'pending')
      .in('user_id', userIds)
      .order('created_at', { ascending: false })

    const pendingLeaves = ((leaveData ?? []) as LeaveRequest[]).map(lr => ({
      ...lr,
      userName: allUsers.find(u => u.id === lr.user_id)?.name ?? 'Unknown',
    }))
    setPending(pendingLeaves)

    // Recent screenshots from all team members
    if (userIds.length > 0) {
      const { data: shotData } = await supabase
        .from('screenshots')
        .select('*')
        .in('user_id', userIds)
        .eq('date', today)
        .order('timestamp', { ascending: false })
        .limit(6)
      setShots((shotData ?? []) as Screenshot[])
    }

    setLoading(false)
  }, [user])

  useEffect(() => { void load() }, [load])
  useRealtime({ table: 'time_logs', onInsert: () => void load(), onUpdate: () => void load() })

  async function handleLeave(id: string, status: 'approved' | 'rejected') {
    setActioning(id)
    await supabase.from('leave_requests').update({ status }).eq('id', id)
    setPending(p => p.filter(l => l.id !== id))
    setActioning(null)
  }

  // Computed counts
  const online  = members.filter(m => m.workStatus === 'working').length
  const onLunch = members.filter(m => m.workStatus === 'lunch').length
  const offline = members.filter(m => m.workStatus === 'absent').length
  const total   = members.length

  const dateStr = now.toLocaleDateString('en-SG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  const timeStr = now.toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40 text-sm text-gray-400">
        Loading dashboard…
      </div>
    )
  }

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <p className="text-sm text-gray-500">{dateStr}</p>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 mt-0.5">
            {greeting()}, {user?.name.split(' ')[0]} 👋
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {user?.sub_account} · {total} member{total !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="sm:text-right">
          <p className="text-2xl sm:text-3xl font-mono font-bold text-gray-900 tracking-tight">{timeStr}</p>
          <p className="text-xs text-gray-400 mt-0.5">Live</p>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <StatCard label="Total Staff"    value={total}           sub="in workspace" />
        <StatCard label="Online Now"     value={online}          sub="clocked in"       accent="text-green-600" />
        <StatCard label="On Lunch"       value={onLunch}         sub="lunch break"       accent="text-amber-500" />
        <StatCard label="Offline"        value={offline}         sub="not clocked in"   accent="text-gray-500" />
        <StatCard label="Pending Leaves" value={pending.length}  sub="awaiting approval" accent={pending.length > 0 ? 'text-violet-600' : 'text-gray-900'} />
      </div>

      {/* Live Team Status Table */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="font-semibold text-gray-900">Live Team Status</h2>
            <p className="text-xs text-gray-400 mt-0.5">Updates in real time via Supabase Realtime</p>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-green-600 font-medium">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            Live
          </div>
        </div>

        <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[600px]">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Member</th>
              <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Role</th>
              <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Status</th>
              <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Clock In</th>
              <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Today</th>
              <th className="text-right px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Activity</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {members.map(m => {
              const clockInTime = m.clockIn
                ? new Date(m.clockIn).toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', hour12: true })
                : null

              return (
                <tr key={m.id} className="hover:bg-gray-50/50 transition-colors">
                  <td className="px-6 py-3.5">
                    <div className="flex items-center gap-3">
                      <Avatar name={m.name} imageUrl={m.profile_image} size="md" online={m.workStatus !== 'absent'} />
                      <div>
                        <p className="font-medium text-gray-900 text-sm">{m.name}</p>
                        <p className="text-xs text-gray-400 truncate max-w-[160px]">{m.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-3.5">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                      m.role === 'Admin' ? 'bg-violet-100 text-violet-700' :
                      m.role === 'Manager'     ? 'bg-blue-100 text-blue-700' :
                                                 'bg-gray-100 text-gray-600'
                    }`}>
                      {m.role}
                    </span>
                  </td>
                  <td className="px-6 py-3.5">
                    <StatusBadge status={m.workStatus} />
                  </td>
                  <td className="px-6 py-3.5 text-sm text-gray-600">
                    {clockInTime ?? <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-6 py-3.5">
                    {m.hoursToday > 0 ? (
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-800">{fmtHours(m.hoursToday)}</span>
                        <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-green-400 rounded-full"
                            style={{ width: `${Math.min(100, (m.hoursToday / (8 * 60)) * 100)}%` }}
                          />
                        </div>
                      </div>
                    ) : (
                      <span className="text-gray-300 text-sm">—</span>
                    )}
                  </td>
                  <td className="px-6 py-3.5 text-right">
                    <button
                      onClick={() => setSelected({ ...m, isOnline: m.workStatus !== 'absent' })}
                      className="text-xs font-medium text-violet-600 hover:text-violet-800 border border-violet-200 rounded-lg px-3 py-1 hover:bg-violet-50 transition-colors"
                    >
                      View Log
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        </div>
      </div>

      {/* Bottom Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Pending Leave Requests */}
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-gray-900">Leave Requests</h2>
              <p className="text-xs text-gray-400 mt-0.5">Pending approval</p>
            </div>
            {pending.length > 0 && (
              <span className="bg-violet-600 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                {pending.length}
              </span>
            )}
          </div>

          {pending.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-gray-400">
              <span className="text-3xl mb-2">✅</span>
              <p className="text-sm">All caught up — no pending requests</p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-50">
              {pending.map(lr => (
                <li key={lr.id} className="px-6 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 text-sm">{lr.userName}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        <span className="font-medium">{lr.type}</span> ·{' '}
                        {new Date(lr.start_date).toLocaleDateString('en-SG', { month: 'short', day: 'numeric' })}
                        {' – '}
                        {new Date(lr.end_date).toLocaleDateString('en-SG', { month: 'short', day: 'numeric' })}
                      </p>
                      {lr.reason && (
                        <p className="text-xs text-gray-400 mt-1 truncate">{lr.reason}</p>
                      )}
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button
                        onClick={() => handleLeave(lr.id, 'approved')}
                        disabled={actioning === lr.id}
                        className="text-xs font-semibold text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-1.5 hover:bg-green-100 disabled:opacity-50 transition-colors"
                      >
                        {actioning === lr.id ? '…' : 'Approve'}
                      </button>
                      <button
                        onClick={() => handleLeave(lr.id, 'rejected')}
                        disabled={actioning === lr.id}
                        className="text-xs font-semibold text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-1.5 hover:bg-red-100 disabled:opacity-50 transition-colors"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Recent Team Screenshots */}
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900">Recent Team Screenshots</h2>
            <p className="text-xs text-gray-400 mt-0.5">Latest captures from all team members today</p>
          </div>

          {shots.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-gray-400">
              <span className="text-3xl mb-2">📷</span>
              <p className="text-sm">No screenshots captured yet today</p>
            </div>
          ) : (
            <div className="p-4 grid grid-cols-3 gap-2">
              {shots.map(s => {
                const owner = members.find(m => m.id === s.user_id)
                return (
                  <button
                    key={s.id}
                    onClick={() => setLightbox(s)}
                    className="relative aspect-video bg-gray-100 rounded-xl overflow-hidden hover:opacity-90 transition-opacity group"
                  >
                    <img src={s.url} alt="Screenshot" className="w-full h-full object-cover" />
                    {owner && (
                      <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/60 to-transparent p-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <p className="text-white text-[10px] font-medium truncate">{owner.name.split(' ')[0]}</p>
                        <p className="text-white/70 text-[10px]">
                          {new Date(s.timestamp).toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <div className="max-w-4xl w-full">
            <img src={lightbox.url} alt="Screenshot" className="w-full rounded-xl shadow-2xl" />
            <div className="flex items-center justify-between mt-3">
              <p className="text-white/70 text-sm">
                {members.find(m => m.id === lightbox.user_id)?.name}
              </p>
              <p className="text-white/70 text-sm">
                {new Date(lightbox.timestamp).toLocaleString('en-SG')}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Activity Drawer */}
      {selected && <UserActivityDrawer user={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
