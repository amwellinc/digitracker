import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import { todayInTz, DEFAULT_TIMEZONE } from '@/lib/timezone'

function isoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
import { useClockContext } from './ClockContext'
import type { Screenshot } from '@/types'
import { StatCards } from './StatCards'
import { TeamAvatarRow } from './TeamAvatarRow'
import { AdminDashboard } from '@/features/dashboard/AdminDashboard'

interface DayLog {
  date: string
  total_minutes: number
}

interface Holiday {
  id: string
  date: string
  name: string
}

interface Notification {
  id: string
  type: string
  message: string
  read: boolean
  created_at: string
}

function fmtMinutes(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

function fmtDate(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', {
    weekday: 'short', day: '2-digit', month: 'short',
  })
}

function monthRange(offset: 0 | -1): { start: string; end: string; label: string } {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + offset
  const first = new Date(year, month, 1)
  const last = new Date(year, month + 1, 0)
  return {
    start: isoDate(first),
    end:   isoDate(last),
    label: first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
  }
}

export function TimeTrackingPage() {
  const { user } = useAuth()
  const {
    activeLog,
    dayMinutes,
    lunchStart,
    isCapturing,
    captureError,
    handleClockIn,
    handleClockOut,
    handleStartLunch,
    handleEndLunch,
  } = useClockContext()

  const [liveSeconds,    setLiveSeconds]    = useState(0)
  const [recentShots,    setRecentShots]    = useState<Screenshot[]>([])
  const [showPrevMonth,  setShowPrevMonth]  = useState(false)
  const [dayLogs,        setDayLogs]        = useState<DayLog[]>([])
  const [logsLoading,    setLogsLoading]    = useState(true)
  const [holidays,       setHolidays]       = useState<Holiday[]>([])
  const [notifications,  setNotifications]  = useState<Notification[]>([])
  const [unreadCount,    setUnreadCount]    = useState(0)

  // Live elapsed-time ticker
  useEffect(() => {
    if (!activeLog || activeLog.status === 'clocked_out') {
      setLiveSeconds(0)
      return
    }
    const clockInMs = new Date(activeLog.clock_in).getTime()
    const tick = () => {
      const elapsed    = (Date.now() - clockInMs) / 1000
      const lunchSecs  = lunchStart ? (Date.now() - lunchStart.getTime()) / 1000 : 0
      setLiveSeconds(Math.max(0, Math.floor(elapsed - lunchSecs)))
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [activeLog, lunchStart])

  // Recent screenshots for today
  useEffect(() => {
    if (!user) return
    const today = todayInTz(DEFAULT_TIMEZONE)
    void supabase
      .from('screenshots')
      .select('*')
      .eq('user_id', user.id)
      .eq('date', today)
      .order('timestamp', { ascending: false })
      .limit(4)
      .then(({ data }) => setRecentShots((data ?? []) as Screenshot[]))
  }, [user])

  // Refresh screenshots every minute while capturing
  useEffect(() => {
    if (!isCapturing || !user) return
    const today = todayInTz(DEFAULT_TIMEZONE)
    const id = setInterval(() => {
      void supabase
        .from('screenshots')
        .select('*')
        .eq('user_id', user.id)
        .eq('date', today)
        .order('timestamp', { ascending: false })
        .limit(4)
        .then(({ data }) => setRecentShots((data ?? []) as Screenshot[]))
    }, 60_000)
    return () => clearInterval(id)
  }, [isCapturing, user])

  // Monthly work log
  const fetchLogs = useCallback(async () => {
    if (!user) return
    setLogsLoading(true)
    const { start, end } = monthRange(showPrevMonth ? -1 : 0)
    const { data } = await supabase
      .from('time_logs')
      .select('date, total_minutes')
      .eq('user_id', user.id)
      .gte('date', start)
      .lte('date', end)
      .eq('status', 'clocked_out')
      .order('date', { ascending: false })

    // Aggregate by date (multiple sessions possible)
    const map: Record<string, number> = {}
    for (const row of (data ?? []) as { date: string; total_minutes: number }[]) {
      map[row.date] = (map[row.date] ?? 0) + Number(row.total_minutes)
    }
    setDayLogs(Object.entries(map).map(([date, total_minutes]) => ({ date, total_minutes }))
      .sort((a, b) => b.date.localeCompare(a.date)))
    setLogsLoading(false)
  }, [user, showPrevMonth])

  useEffect(() => { void fetchLogs() }, [fetchLogs])

  // Upcoming holidays
  useEffect(() => {
    if (!user) return
    const today = todayInTz(DEFAULT_TIMEZONE)
    void supabase
      .from('public_holidays')
      .select('id, date, name')
      .gte('date', today)
      .order('date', { ascending: true })
      .limit(8)
      .then(({ data }) => setHolidays((data ?? []) as Holiday[]))
  }, [user])

  // Notifications
  useEffect(() => {
    if (!user) return
    void supabase
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20)
      .then(({ data }) => {
        const rows = (data ?? []) as Notification[]
        setNotifications(rows)
        setUnreadCount(rows.filter(n => !n.read).length)
      })
  }, [user])

  async function markAllRead() {
    if (!user || unreadCount === 0) return
    await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', user.id)
      .eq('read', false)
    setNotifications(prev => prev.map(n => ({ ...n, read: true })))
    setUnreadCount(0)
  }

  async function markRead(id: string) {
    await supabase.from('notifications').update({ read: true }).eq('id', id)
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n))
    setUnreadCount(prev => Math.max(0, prev - 1))
  }

  const isWorking    = activeLog?.status === 'working'
  const isOnLunch    = activeLog?.status === 'lunch'
  const isSuperAdmin = user?.role === 'Admin' || user?.role === 'Super-Admin'

  const { label: monthLabel } = monthRange(showPrevMonth ? -1 : 0)
  const totalMonthMins = dayLogs.reduce((acc, d) => acc + d.total_minutes, 0)

  function notifIcon(type: string) {
    switch (type) {
      case 'task_assigned':  return '✅'
      case 'task_reply':     return '💬'
      case 'leave_request':  return '📋'
      case 'leave_approved': return '✓'
      default:               return '🔔'
    }
  }

  return (
    <div className="space-y-6">
      {isSuperAdmin && <AdminDashboard />}

      {isSuperAdmin && (
        <div className="flex items-center gap-4 pt-2">
          <div className="flex-1 border-t border-gray-200" />
          <span className="text-xs font-medium text-gray-400 uppercase tracking-wide shrink-0">Your Time Tracking</span>
          <div className="flex-1 border-t border-gray-200" />
        </div>
      )}

      {user?.role === 'Manager' && <TeamAvatarRow />}

      {!isSuperAdmin && (
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Time Tracking</h2>
          <p className="text-sm text-gray-500 mt-1">Manage your daily shift and view your activity.</p>
        </div>
      )}

      {captureError && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
          {captureError}
        </div>
      )}

      <StatCards
        status={activeLog?.status ?? 'clocked_out'}
        dayMinutes={dayMinutes}
        liveSeconds={liveSeconds}
        isCapturing={isCapturing}
        isWorking={!!isWorking}
        isOnLunch={!!isOnLunch}
        onClockIn={handleClockIn}
        onStartLunch={handleStartLunch}
        onEndLunch={handleEndLunch}
        onClockOut={handleClockOut}
      />

      {/* Bottom sections: 1-col mobile → 3-col desktop */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Monthly Work Log */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Work Log</h3>
              <p className="text-xs text-gray-400 mt-0.5">{monthLabel}</p>
            </div>
            <div className="flex items-center gap-3">
              {totalMonthMins > 0 && (
                <span className="text-xs bg-violet-50 text-violet-700 font-mono px-2 py-0.5 rounded">
                  {fmtMinutes(totalMonthMins)} total
                </span>
              )}
              <button
                onClick={() => setShowPrevMonth(p => !p)}
                className="text-xs text-violet-600 hover:text-violet-800 font-medium"
              >
                {showPrevMonth ? '← Current month' : 'Previous month →'}
              </button>
            </div>
          </div>

          {logsLoading ? (
            <div className="py-10 text-center text-sm text-gray-300">Loading…</div>
          ) : dayLogs.length === 0 ? (
            <div className="py-10 text-center text-sm text-gray-300">
              No work logged for {monthLabel}
            </div>
          ) : (
            <div className="overflow-y-auto max-h-72">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="text-left px-5 py-2 text-xs font-medium text-gray-400">Date</th>
                    <th className="text-right px-5 py-2 text-xs font-medium text-gray-400">Hours Worked</th>
                    <th className="text-right px-5 py-2 text-xs font-medium text-gray-400 w-28">Progress</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {dayLogs.map(log => {
                    const pct = Math.min(100, Math.round((log.total_minutes / (user?.reporting_time_in && user?.reporting_time_out
                      ? ((() => {
                          const [ih, im] = (user.reporting_time_in).split(':').map(Number)
                          const [oh, om] = (user.reporting_time_out).split(':').map(Number)
                          const diff = (oh * 60 + om) - (ih * 60 + im)
                          return diff > 0 ? diff : 480
                        })())
                      : 480)) * 100))
                    return (
                      <tr key={log.date} className="hover:bg-gray-50">
                        <td className="px-5 py-3 text-gray-700">{fmtDate(log.date)}</td>
                        <td className="px-5 py-3 text-right font-mono font-semibold text-gray-900">
                          {fmtMinutes(log.total_minutes)}
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2 justify-end">
                            <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${pct >= 100 ? 'bg-green-500' : 'bg-violet-400'}`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className="text-xs text-gray-400 w-8 text-right">{pct}%</span>
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

        {/* Right column: Holidays + Notifications stacked */}
        <div className="flex flex-col gap-4">

          {/* Upcoming Holidays */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden flex-shrink-0">
            <div className="px-4 py-3 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-900">🗓 Upcoming Holidays</h3>
            </div>
            {holidays.length === 0 ? (
              <div className="py-6 text-center text-xs text-gray-300">No upcoming holidays</div>
            ) : (
              <ul className="divide-y divide-gray-50 max-h-36 overflow-y-auto">
                {holidays.map(h => (
                  <li key={h.id} className="px-4 py-2.5 flex items-center justify-between gap-3">
                    <span className="text-xs text-gray-700 font-medium truncate">{h.name}</span>
                    <span className="text-xs text-gray-400 font-mono shrink-0">
                      {new Date(h.date + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Notifications */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden flex-1 min-h-0">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-gray-900">🔔 Notifications</h3>
                {unreadCount > 0 && (
                  <span className="text-xs bg-violet-600 text-white font-bold px-1.5 py-0.5 rounded-full leading-none">
                    {unreadCount}
                  </span>
                )}
              </div>
              {unreadCount > 0 && (
                <button
                  onClick={markAllRead}
                  className="text-xs text-violet-600 hover:text-violet-800"
                >
                  Mark all read
                </button>
              )}
            </div>
            {notifications.length === 0 ? (
              <div className="py-6 text-center text-xs text-gray-300">No notifications</div>
            ) : (
              <ul className="divide-y divide-gray-50 overflow-y-auto max-h-52">
                {notifications.map(n => (
                  <li
                    key={n.id}
                    onClick={() => !n.read && void markRead(n.id)}
                    className={`px-4 py-3 flex items-start gap-2.5 cursor-pointer hover:bg-gray-50 transition-colors ${
                      !n.read ? 'bg-violet-50/40' : ''
                    }`}
                  >
                    <span className="text-sm mt-0.5 shrink-0">{notifIcon(n.type)}</span>
                    <div className="min-w-0">
                      <p className={`text-xs leading-snug ${!n.read ? 'text-gray-800 font-medium' : 'text-gray-500'}`}>
                        {n.message}
                      </p>
                      <p className="text-xs text-gray-300 mt-0.5">
                        {new Date(n.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                      </p>
                    </div>
                    {!n.read && (
                      <span className="w-1.5 h-1.5 rounded-full bg-violet-500 mt-1.5 shrink-0" />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* Recent Screenshots */}
      {!isSuperAdmin && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="font-semibold text-gray-900">Recent Screenshots</h3>
              <p className="text-xs text-gray-400 mt-0.5">Auto-captured every 11–18 min while clocked in</p>
            </div>
            <Link to="/screenshots" className="text-xs text-violet-600 hover:text-violet-700 font-medium">
              View all →
            </Link>
          </div>
          {recentShots.length === 0 ? (
            <div className="h-24 flex items-center justify-center text-sm text-gray-300 rounded-lg bg-gray-50">
              No screenshots today yet
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-2">
              {recentShots.map(s => (
                <Link
                  key={s.id}
                  to="/screenshots"
                  className="aspect-video bg-gray-100 rounded-lg overflow-hidden hover:opacity-80 transition-opacity block"
                >
                  <img src={s.url} alt="Screenshot" className="w-full h-full object-cover" />
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
