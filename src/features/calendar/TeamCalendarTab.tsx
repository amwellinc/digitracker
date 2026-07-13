import { useState, useEffect } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import type { User, TimeLog, LeaveRequest, PublicHoliday } from '@/types'
import { todayInTz, DEFAULT_TIMEZONE } from '@/lib/timezone'

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

type DayStatus = 'worked' | 'half' | 'leave' | 'absent' | 'holiday' | 'weekend' | 'future' | 'today'

const CELL: Record<DayStatus, string> = {
  worked:  'bg-green-500',
  half:    'bg-teal-400',
  leave:   'bg-blue-400',
  absent:  'bg-red-400',
  holiday: 'bg-amber-400',
  weekend: 'bg-gray-50',
  future:  'bg-transparent',
  today:   'bg-violet-400',
}

function isoDate(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
function isWeekend(d: Date) { const day = d.getDay(); return day === 0 || day === 6 }

function dayStatus(
  dateStr: string,
  today: string,
  userLogs: TimeLog[],
  userLeaves: LeaveRequest[],
  holidays: PublicHoliday[],
): DayStatus {
  if (dateStr > today) return 'future'
  if (holidays.some(h => h.date === dateStr)) return 'holiday'
  const d = new Date(dateStr + 'T00:00:00')
  if (isWeekend(d)) return 'weekend'
  const leave = userLeaves.find(l => l.status === 'approved' && l.start_date <= dateStr && l.end_date >= dateStr)
  if (leave) return 'leave'
  const logs = userLogs.filter(l => l.date === dateStr)
  const mins = logs.reduce((s, l) => s + (l.total_minutes ?? 0), 0)
  if (logs.length > 0) return mins >= 240 ? 'worked' : 'half'
  if (dateStr === today) return 'today'
  return 'absent'
}

export function TeamCalendarTab({ timezone = DEFAULT_TIMEZONE }: { timezone?: string }) {
  const { user } = useAuth()
  const [year, setYear] = useState(() => {
    const t = todayInTz(timezone); return parseInt(t.slice(0, 4))
  })
  const [month, setMonth] = useState(() => {
    const t = todayInTz(timezone); return parseInt(t.slice(5, 7)) - 1
  })
  const [members, setMembers] = useState<User[]>([])
  const [allLogs, setAllLogs] = useState<TimeLog[]>([])
  const [allLeaves, setAllLeaves] = useState<LeaveRequest[]>([])
  const [holidays, setHolidays] = useState<PublicHoliday[]>([])

  useEffect(() => {
    if (!user) return
    const from = `${year}-${String(month + 1).padStart(2, '0')}-01`
    const lastDay = new Date(year, month + 1, 0).getDate()
    const to = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

    void Promise.all([
      supabase.from('users').select('*').eq('sub_account', user.sub_account).order('name'),
      supabase.from('time_logs').select('*').gte('date', from).lte('date', to),
      supabase.from('leave_requests').select('*').eq('status', 'approved').lte('start_date', to).gte('end_date', from),
      supabase.from('public_holidays').select('*').eq('sub_account', user.sub_account).gte('date', from).lte('date', to),
    ]).then(([u, logs, lv, hols]) => {
      setMembers((u.data ?? []) as User[])
      setAllLogs((logs.data ?? []) as TimeLog[])
      setAllLeaves((lv.data ?? []) as LeaveRequest[])
      setHolidays((hols.data ?? []) as PublicHoliday[])
    })
  }, [user, year, month])

  function prev() { if (month === 0) { setYear(y => y - 1); setMonth(11) } else setMonth(m => m - 1) }
  function next() { if (month === 11) { setYear(y => y + 1); setMonth(0) } else setMonth(m => m + 1) }

  const todayStr = todayInTz(timezone)
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const days = Array.from({ length: daysInMonth }, (_, i) => {
    const d = new Date(year, month, i + 1)
    return { num: i + 1, str: isoDate(d), weekend: isWeekend(d) }
  })

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-gray-900">Team Attendance Matrix</h2>
          <p className="text-sm text-gray-400">All team members · {MONTHS[month]} {year}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={prev} className="w-8 h-8 rounded-full border border-gray-200 flex items-center justify-center hover:bg-gray-50 text-sm">‹</button>
          <span className="text-sm font-medium text-gray-700 w-32 text-center">{MONTHS[month]} {year}</span>
          <button onClick={next} className="w-8 h-8 rounded-full border border-gray-200 flex items-center justify-center hover:bg-gray-50 text-sm">›</button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-xs">
        {[
          { cls: 'bg-green-500', label: 'Full Day' },
          { cls: 'bg-teal-400',  label: 'Half Day' },
          { cls: 'bg-blue-400',  label: 'On Leave' },
          { cls: 'bg-red-400',   label: 'Absent' },
          { cls: 'bg-amber-400', label: 'Holiday' },
          { cls: 'bg-violet-400',label: 'Today' },
        ].map(l => (
          <div key={l.label} className="flex items-center gap-1.5">
            <span className={`w-3 h-3 rounded-sm ${l.cls}`} />
            <span className="text-gray-600">{l.label}</span>
          </div>
        ))}
      </div>

      {/* Matrix Table */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-auto">
        <table className="text-xs border-collapse w-full">
          <thead>
            <tr className="bg-gray-50">
              <th className="text-left px-4 py-3 text-gray-600 font-semibold sticky left-0 bg-gray-50 z-10 min-w-[140px] border-r border-gray-100">
                Team Member
              </th>
              {days.map(d => (
                <th
                  key={d.str}
                  className={`px-1 py-3 font-medium text-center min-w-[28px] ${d.weekend ? 'text-gray-300' : 'text-gray-500'}`}
                >
                  <div>{d.num}</div>
                  <div className="text-[9px] text-gray-400">
                    {['S','M','T','W','T','F','S'][new Date(d.str + 'T00:00:00').getDay()]}
                  </div>
                </th>
              ))}
              <th className="px-3 py-3 text-gray-600 font-semibold text-right min-w-[60px]">Days</th>
              <th className="px-3 py-3 text-gray-600 font-semibold text-right min-w-[60px]">Hours</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {members.map(m => {
              const userLogs     = allLogs.filter(l => l.user_id === m.id)
              const userLeaves   = allLeaves.filter(l => l.user_id === m.id)
              const userHolidays = holidays.filter(h => h.country === (m.country ?? 'SG'))
              const workedDays = userLogs.filter(l => l.status === 'clocked_out').length
              const totalHrs   = Math.round(userLogs.reduce((s, l) => s + (l.total_minutes ?? 0), 0) / 60)

              return (
                <tr key={m.id} className="hover:bg-gray-50/50">
                  <td className="px-4 py-2 sticky left-0 bg-white border-r border-gray-100">
                    <div className="font-medium text-gray-900 truncate max-w-[128px]">{m.name}</div>
                    <div className="text-[10px] text-gray-400">{m.role}</div>
                  </td>
                  {days.map(d => {
                    const status = dayStatus(d.str, todayStr, userLogs, userLeaves, userHolidays)
                    return (
                      <td key={d.str} className="px-1 py-2 text-center">
                        <div className={`mx-auto w-5 h-5 rounded-sm ${CELL[status]}`} />
                      </td>
                    )
                  })}
                  <td className="px-3 py-2 text-right font-semibold text-gray-700">{workedDays}</td>
                  <td className="px-3 py-2 text-right font-semibold text-gray-700">{totalHrs}h</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {members.length === 0 && (
          <div className="py-12 text-center text-sm text-gray-400">No team members found.</div>
        )}
      </div>
    </div>
  )
}
