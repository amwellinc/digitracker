import { useState, useEffect } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import type { User, TimeLog, LeaveRequest, PublicHoliday } from '@/types'
import { CalendarGrid } from './CalendarGrid'
import type { DayInfo } from './CalendarGrid'
import { todayInTz, DEFAULT_TIMEZONE } from '@/lib/timezone'

function fmtTime(ts: string | null) {
  if (!ts) return '—'
  return new Date(ts).toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', hour12: true })
}

function fmtMins(m: number) {
  if (!m) return '—'
  return `${Math.floor(m / 60)}h ${Math.floor(m % 60)}m`
}

const STATUS_LABEL: Record<string, string> = {
  worked_full: 'Full Day Worked', worked_half: 'Half Day',
  annual_leave: 'Annual Leave', medical_leave: 'Medical Leave', time_off: 'Time Off',
  absent: 'Absent', holiday: 'Public Holiday', weekend: 'Weekend', future: 'Upcoming', today: 'Today',
}

function DayModal({ info, userName, onClose }: { info: DayInfo; userName: string; onClose: () => void }) {
  const d = new Date(info.date + 'T00:00:00')
  const label = d.toLocaleDateString('en-SG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-semibold text-gray-900">{label}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
        </div>
        <p className="text-xs text-gray-400 mb-4">{userName}</p>
        <div className="space-y-2.5 text-sm">
          {[
            ['Status',       STATUS_LABEL[info.status] ?? info.status],
            ...(info.clockIn  ? [['Clock In',  fmtTime(info.clockIn)]]  : []),
            ...(info.clockOut ? [['Clock Out', fmtTime(info.clockOut)]] : []),
            ...(info.totalMins > 0 ? [['Hours Worked', fmtMins(info.totalMins)]] : []),
            ...(info.leave ? [['Leave Type', info.leave.type], ...(info.leave.reason ? [['Reason', info.leave.reason]] : [])] : []),
            ...(info.isHoliday ? [['Holiday', info.isHoliday.name]] : []),
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4">
              <span className="text-gray-500">{k}</span>
              <span className="font-medium text-gray-900 text-right">{v}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function UserCalendarTab({ timezone = DEFAULT_TIMEZONE }: { timezone?: string }) {
  const { user } = useAuth()
  const todayStr = todayInTz(timezone)
  const [members, setMembers] = useState<User[]>([])
  const [selectedUser, setSelectedUser] = useState<User | null>(null)
  const [year, setYear] = useState(() => parseInt(todayStr.slice(0, 4)))
  const [month, setMonth] = useState(() => parseInt(todayStr.slice(5, 7)) - 1)
  const [timeLogs, setTimeLogs] = useState<TimeLog[]>([])
  const [leaves, setLeaves] = useState<LeaveRequest[]>([])
  const [holidays, setHolidays] = useState<PublicHoliday[]>([])
  const [selectedDay, setSelectedDay] = useState<DayInfo | null>(null)

  // Load team members
  useEffect(() => {
    if (!user) return
    void supabase.from('users').select('*').eq('sub_account', user.sub_account).order('name').then(({ data }) => {
      const users = (data ?? []) as User[]
      setMembers(users)
      if (users.length > 0) setSelectedUser(users[0])
    })
  }, [user])

  // Load data when selected user or month changes
  useEffect(() => {
    if (!selectedUser || !user) return
    const from = `${year}-${String(month + 1).padStart(2, '0')}-01`
    const lastDay = new Date(year, month + 1, 0).getDate()
    const to = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

    void Promise.all([
      supabase.from('time_logs').select('*').eq('user_id', selectedUser.id).gte('date', from).lte('date', to),
      supabase.from('leave_requests').select('*').eq('user_id', selectedUser.id).eq('status', 'approved').lte('start_date', to).gte('end_date', from),
      supabase.from('public_holidays').select('*').eq('sub_account', user.sub_account).eq('country', selectedUser.country ?? 'SG').gte('date', from).lte('date', to),
    ]).then(([logs, lv, hols]) => {
      setTimeLogs((logs.data ?? []) as TimeLog[])
      setLeaves((lv.data ?? []) as LeaveRequest[])
      setHolidays((hols.data ?? []) as PublicHoliday[])
    })
  }, [selectedUser, year, month, user])

  function prev() { if (month === 0) { setYear(y => y - 1); setMonth(11) } else setMonth(m => m - 1) }
  function next() { if (month === 11) { setYear(y => y + 1); setMonth(0) } else setMonth(m => m + 1) }

  const workedDays = timeLogs.filter(l => l.status === 'clocked_out').length
  const totalHrs   = Math.floor(timeLogs.reduce((s, l) => s + (l.total_minutes ?? 0), 0) / 60)
  const leaveDays  = leaves.length

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 flex-wrap">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Select Member</label>
          <select
            value={selectedUser?.id ?? ''}
            onChange={e => {
              const u = members.find(m => m.id === e.target.value)
              if (u) { setSelectedUser(u); setSelectedDay(null) }
            }}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
          >
            {members.map(m => <option key={m.id} value={m.id}>{m.name} ({m.role})</option>)}
          </select>
        </div>
        {selectedUser && (
          <div className="flex gap-4 pt-4">
            <Stat label="Days Worked" value={String(workedDays)} color="text-green-600" />
            <Stat label="Total Hours"  value={`${totalHrs}h`}   color="text-blue-600" />
            <Stat label="On Leave"     value={String(leaveDays)} color="text-violet-600" />
          </div>
        )}
      </div>

      {selectedUser && (
        <div className="flex gap-6">
          <div className="flex-1 bg-white rounded-2xl border border-gray-200 p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-full bg-violet-200 text-violet-700 text-sm font-bold flex items-center justify-center">
                {selectedUser.name.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <p className="font-semibold text-gray-900">{selectedUser.name}</p>
                <p className="text-xs text-gray-400">{selectedUser.role}</p>
              </div>
            </div>
            <CalendarGrid
              year={year} month={month}
              timeLogs={timeLogs} leaves={leaves} holidays={holidays}
              timezone={timezone}
              onPrev={prev} onNext={next}
              onDayClick={setSelectedDay}
            />
          </div>
          <div className="w-56">
            <div className="bg-white rounded-2xl border border-gray-200 p-5">
              <h3 className="font-semibold text-gray-900 mb-3">Leave Entitlements</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-gray-500">Annual Leave</span><span className="font-medium">{selectedUser.annual_leave}d</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Time-off</span><span className="font-medium">{selectedUser.time_off}d</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Manager</span><span className="font-medium text-xs text-right">{members.find(m => m.id === selectedUser.manager_id)?.name ?? '—'}</span></div>
              </div>
            </div>
          </div>
        </div>
      )}

      {selectedDay && selectedUser && (
        <DayModal info={selectedDay} userName={selectedUser.name} onClose={() => setSelectedDay(null)} />
      )}
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-gray-50 rounded-xl px-4 py-2 text-center">
      <p className={`text-lg font-bold ${color}`}>{value}</p>
      <p className="text-xs text-gray-500">{label}</p>
    </div>
  )
}
