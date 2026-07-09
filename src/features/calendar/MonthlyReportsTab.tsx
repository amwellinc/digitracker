import { useState, useEffect } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import type { User, TimeLog, LeaveRequest } from '@/types'

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

interface UserReport {
  user: User
  daysWorked: number
  totalHours: number
  totalMins: number
  daysAbsent: number
  daysOnLeave: number
  avgHoursPerDay: string
}

function isoDate(d: Date) { return d.toISOString().split('T')[0] }
function isWeekend(d: Date) { const day = d.getDay(); return day === 0 || day === 6 }

function workdaysInMonth(year: number, month: number): number {
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  let count = 0
  for (let i = 1; i <= daysInMonth; i++) {
    const d = new Date(year, month, i)
    if (!isWeekend(d)) count++
  }
  return count
}

export function MonthlyReportsTab() {
  const { user } = useAuth()
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())
  const [reports, setReports] = useState<UserReport[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!user) return
    setLoading(true)

    const from = `${year}-${String(month + 1).padStart(2, '0')}-01`
    const lastDay = new Date(year, month + 1, 0).getDate()
    const to = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

    void Promise.all([
      supabase.from('users').select('*').eq('sub_account', user.sub_account).order('name'),
      supabase.from('time_logs').select('*').gte('date', from).lte('date', to),
      supabase.from('leave_requests').select('*').eq('status', 'approved').lte('start_date', to).gte('end_date', from),
    ]).then(([u, logs, lv]) => {
      const members = (u.data ?? []) as User[]
      const allLogs = (logs.data ?? []) as TimeLog[]
      const allLeaves = (lv.data ?? []) as LeaveRequest[]

      const todayStr = isoDate(today)
      const totalWorkdays = workdaysInMonth(year, month)

      const rpts: UserReport[] = members.map(m => {
        const userLogs   = allLogs.filter(l => l.user_id === m.id && l.status === 'clocked_out')
        const userLeaves = allLeaves.filter(l => l.user_id === m.id)
        const totalMins  = userLogs.reduce((s, l) => s + (l.total_minutes ?? 0), 0)
        const daysWorked = userLogs.length

        // Count leave days in month
        let leaveDays = 0
        for (let i = 1; i <= lastDay; i++) {
          const d = new Date(year, month, i)
          if (isWeekend(d)) continue
          const dateStr = isoDate(d)
          if (dateStr > todayStr) continue
          if (userLeaves.some(l => l.start_date <= dateStr && l.end_date >= dateStr)) leaveDays++
        }

        // Count elapsed workdays so far this month
        const elapsedWorkdays = Math.min(totalWorkdays, Array.from({ length: lastDay }, (_, i) => {
          const d = new Date(year, month, i + 1)
          return (!isWeekend(d) && isoDate(d) <= todayStr) ? 1 : 0 as 0 | 1
        }).reduce<number>((s, v) => s + v, 0))

        const daysAbsent = Math.max(0, elapsedWorkdays - daysWorked - leaveDays)
        const avgHoursPerDay = daysWorked > 0
          ? `${(totalMins / daysWorked / 60).toFixed(1)}h`
          : '—'

        return { user: m, daysWorked, totalHours: Math.floor(totalMins / 60), totalMins, daysAbsent, daysOnLeave: leaveDays, avgHoursPerDay }
      })

      setReports(rpts)
      setLoading(false)
    })
  }, [user, year, month])

  function prev() { if (month === 0) { setYear(y => y - 1); setMonth(11) } else setMonth(m => m - 1) }
  function next() { if (month === 11) { setYear(y => y + 1); setMonth(0) } else setMonth(m => m + 1) }

  function exportCSV() {
    const header = 'Name,Role,Days Worked,Total Hours,Days Absent,Days On Leave,Avg Hours/Day'
    const rows = reports.map(r =>
      `"${r.user.name}","${r.user.role}",${r.daysWorked},${r.totalHours},${r.daysAbsent},${r.daysOnLeave},${r.avgHoursPerDay}`
    )
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `attendance-${MONTHS[month]}-${year}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const teamTotalHrs    = reports.reduce((s, r) => s + r.totalHours, 0)
  const avgAttendance   = reports.length > 0 ? Math.round(reports.reduce((s, r) => s + r.daysWorked, 0) / reports.length) : 0

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="font-semibold text-gray-900">Monthly Attendance Report</h2>
          <p className="text-sm text-gray-400">Summary for {MONTHS[month]} {year}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <button onClick={prev} className="w-8 h-8 rounded-full border border-gray-200 flex items-center justify-center hover:bg-gray-50 text-sm">‹</button>
            <span className="text-sm font-medium text-gray-700 w-32 text-center">{MONTHS[month]} {year}</span>
            <button onClick={next} className="w-8 h-8 rounded-full border border-gray-200 flex items-center justify-center hover:bg-gray-50 text-sm">›</button>
          </div>
          <button
            onClick={exportCSV}
            className="flex items-center gap-2 text-sm font-medium text-violet-600 border border-violet-200 rounded-lg px-4 py-2 hover:bg-violet-50 transition-colors"
          >
            ↓ Export CSV
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 px-5 py-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Team Members</p>
          <p className="text-2xl font-bold text-gray-900">{reports.length}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 px-5 py-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Total Team Hours</p>
          <p className="text-2xl font-bold text-green-600">{teamTotalHrs}h</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 px-5 py-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Avg Days Worked</p>
          <p className="text-2xl font-bold text-blue-600">{avgAttendance}d</p>
        </div>
      </div>

      {/* Report Table */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="py-12 text-center text-sm text-gray-400">Loading report…</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Member</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Role</th>
                <th className="text-center px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Days Worked</th>
                <th className="text-center px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Total Hours</th>
                <th className="text-center px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Avg / Day</th>
                <th className="text-center px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">On Leave</th>
                <th className="text-center px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Absent</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Attendance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {reports.map(r => {
                const totalEligible = r.daysWorked + r.daysAbsent + r.daysOnLeave
                const pct = totalEligible > 0 ? Math.round((r.daysWorked / totalEligible) * 100) : 0
                return (
                  <tr key={r.user.id} className="hover:bg-gray-50/50">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-full bg-violet-100 text-violet-700 text-xs font-bold flex items-center justify-center shrink-0">
                          {r.user.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">{r.user.name}</p>
                          <p className="text-xs text-gray-400">{r.user.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                        r.user.role === 'Admin' ? 'bg-violet-100 text-violet-700' :
                        r.user.role === 'Manager'     ? 'bg-blue-100 text-blue-700' :
                                                        'bg-gray-100 text-gray-600'
                      }`}>{r.user.role}</span>
                    </td>
                    <td className="px-5 py-3 text-center font-semibold text-green-700">{r.daysWorked}</td>
                    <td className="px-5 py-3 text-center font-semibold text-gray-700">{r.totalHours}h</td>
                    <td className="px-5 py-3 text-center text-gray-600">{r.avgHoursPerDay}</td>
                    <td className="px-5 py-3 text-center">
                      {r.daysOnLeave > 0 ? (
                        <span className="text-blue-600 font-semibold">{r.daysOnLeave}d</span>
                      ) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-5 py-3 text-center">
                      {r.daysAbsent > 0 ? (
                        <span className="text-red-500 font-semibold">{r.daysAbsent}d</span>
                      ) : <span className="text-green-500 font-semibold">0</span>}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${pct >= 90 ? 'bg-green-500' : pct >= 70 ? 'bg-amber-400' : 'bg-red-400'}`} style={{ width: `${pct}%` }} />
                        </div>
                        <span className={`text-xs font-bold ${pct >= 90 ? 'text-green-600' : pct >= 70 ? 'text-amber-600' : 'text-red-500'}`}>{pct}%</span>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
