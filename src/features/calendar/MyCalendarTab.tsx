import { useState, useEffect } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import type { TimeLog, LeaveRequest, PublicHoliday } from '@/types'
import { CalendarGrid } from './CalendarGrid'
import type { DayInfo } from './CalendarGrid'
import { todayInTz, DEFAULT_TIMEZONE } from '@/lib/timezone'

const LEGEND = [
  { label: 'Full-day Worked',  cls: 'bg-green-500' },
  { label: 'Half-day Worked',  cls: 'bg-teal-400' },
  { label: 'Absent',           cls: 'bg-red-400' },
  { label: 'Medical Leave',    cls: 'bg-orange-400' },
  { label: 'Time-off',         cls: 'bg-violet-500' },
  { label: 'Annual Leave',     cls: 'bg-blue-500' },
  { label: 'Public Holiday',   cls: 'bg-amber-400' },
]

function fmtTime(ts: string | null) {
  if (!ts) return '—'
  return new Date(ts).toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', hour12: true })
}

function fmtMins(m: number) {
  if (!m) return '—'
  return `${Math.floor(m / 60)}h ${Math.floor(m % 60)}m`
}

interface DayModalProps {
  info: DayInfo
  onClose: () => void
}

function DayModal({ info, onClose }: DayModalProps) {
  const d = new Date(info.date + 'T00:00:00')
  const label = d.toLocaleDateString('en-SG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  const statusLabel: Record<string, string> = {
    worked_full: 'Full Day Worked', worked_half: 'Half Day Worked',
    annual_leave: 'Annual Leave', medical_leave: 'Medical Leave', time_off: 'Time Off',
    absent: 'Absent', holiday: 'Public Holiday', weekend: 'Weekend', future: 'Upcoming', today: 'Today',
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-900">{label}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
        </div>
        <div className="space-y-3 text-sm">
          <Row label="Status"     value={statusLabel[info.status] ?? info.status} />
          {info.clockIn  && <Row label="Clock In"  value={fmtTime(info.clockIn)} />}
          {info.clockOut && <Row label="Clock Out" value={fmtTime(info.clockOut)} />}
          {info.totalMins > 0 && <Row label="Hours Worked" value={fmtMins(info.totalMins)} />}
          {info.leave && (
            <>
              <Row label="Leave Type" value={info.leave.type} />
              {info.leave.reason && <Row label="Reason" value={info.leave.reason} />}
            </>
          )}
          {info.isHoliday && <Row label="Holiday" value={info.isHoliday.name} />}
        </div>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-gray-900 text-right">{value}</span>
    </div>
  )
}

export function MyCalendarTab({ timezone = DEFAULT_TIMEZONE }: { timezone?: string }) {
  const { user } = useAuth()
  const todayStr = todayInTz(timezone)
  const [year, setYear] = useState(() => parseInt(todayStr.slice(0, 4)))
  const [month, setMonth] = useState(() => parseInt(todayStr.slice(5, 7)) - 1)
  const [timeLogs, setTimeLogs] = useState<TimeLog[]>([])
  const [leaves, setLeaves] = useState<LeaveRequest[]>([])
  const [holidays, setHolidays] = useState<PublicHoliday[]>([])
  const [selected, setSelected] = useState<DayInfo | null>(null)

  useEffect(() => {
    if (!user) return
    const from = `${year}-${String(month + 1).padStart(2, '0')}-01`
    const lastDay = new Date(year, month + 1, 0).getDate()
    const to = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

    void Promise.all([
      supabase.from('time_logs').select('*').eq('user_id', user.id).gte('date', from).lte('date', to),
      supabase.from('leave_requests').select('*').eq('user_id', user.id).eq('status', 'approved').lte('start_date', to).gte('end_date', from),
      supabase.from('public_holidays').select('*').eq('sub_account', user.sub_account).eq('country', user.country ?? 'SG').gte('date', from).lte('date', to),
    ]).then(([logs, lv, hols]) => {
      setTimeLogs((logs.data ?? []) as TimeLog[])
      setLeaves((lv.data ?? []) as LeaveRequest[])
      setHolidays((hols.data ?? []) as PublicHoliday[])
    })
  }, [user, year, month])

  function prev() { if (month === 0) { setYear(y => y - 1); setMonth(11) } else setMonth(m => m - 1) }
  function next() { if (month === 11) { setYear(y => y + 1); setMonth(0) } else setMonth(m => m + 1) }

  // Summary counts
  const workedDays    = timeLogs.filter(l => l.date && l.status === 'clocked_out').length
  const leaveDays     = leaves.length
  const totalHours    = Math.floor(timeLogs.reduce((s, l) => s + (l.total_minutes ?? 0), 0) / 60)

  return (
    <div className="flex gap-6">
      {/* Calendar */}
      <div className="flex-1 bg-white rounded-2xl border border-gray-200 p-6">
        <div className="mb-4">
          <h2 className="font-semibold text-gray-900 text-lg">My Calendar</h2>
          <p className="text-sm text-gray-400">Click a date to see details.</p>
        </div>
        <div className="flex gap-4 mb-6">
          <Pill label="Days Worked" value={String(workedDays)} color="text-green-600" />
          <Pill label="Total Hours" value={`${totalHours}h`} color="text-blue-600" />
          <Pill label="On Leave"    value={String(leaveDays)} color="text-violet-600" />
        </div>
        <CalendarGrid
          year={year} month={month}
          timeLogs={timeLogs} leaves={leaves} holidays={holidays}
          timezone={timezone}
          onPrev={prev} onNext={next}
          onDayClick={setSelected}
        />
      </div>

      {/* Legend + Summary */}
      <div className="w-56 space-y-4">
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-900 mb-3">Activity Legend</h3>
          <ul className="space-y-2">
            {LEGEND.map(l => (
              <li key={l.label} className="flex items-center gap-2.5 text-sm text-gray-700">
                <span className={`w-3 h-3 rounded-full shrink-0 ${l.cls}`} />
                {l.label}
              </li>
            ))}
          </ul>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-900 mb-3">Leave Balance</h3>
          <div className="space-y-2 text-sm">
            <Row label="Annual" value={`${user?.annual_leave ?? 0}d`} />
            <Row label="Time-off" value={`${user?.time_off ?? 0}d`} />
          </div>
        </div>
      </div>

      {selected && <DayModal info={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}

function Pill({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-gray-50 rounded-xl px-4 py-2 text-center">
      <p className={`text-lg font-bold ${color}`}>{value}</p>
      <p className="text-xs text-gray-500">{label}</p>
    </div>
  )
}
