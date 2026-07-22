import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import type { User, TimeLog, LeaveRequest } from '@/types'
import { useSubAccountTimezone } from '@/hooks/useSubAccountTimezone'
import { todayInTz } from '@/lib/timezone'
import {
  getDateRange, shiftAnchor, buildUserReport,
  type ReportRangeMode, type UserReportRow, type KpiDailyLogRow,
} from '@/lib/reportData'
import { TeamReportView } from './TeamReportView'
import { IndividualReportView } from './IndividualReportView'

const MODES: { id: ReportRangeMode; label: string }[] = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
]

export function ReportsPage() {
  const { user } = useAuth()
  const timezone = useSubAccountTimezone()
  const [mode, setMode] = useState<ReportRangeMode>('week')
  const [anchor, setAnchor] = useState(new Date())
  const [view, setView] = useState<'team' | 'individual'>('team')
  const [selectedUserId, setSelectedUserId] = useState<string>('')

  const [members, setMembers] = useState<User[]>([])
  const [reports, setReports] = useState<UserReportRow[]>([])
  const [rawTimeLogs, setRawTimeLogs] = useState<TimeLog[]>([])
  const [loading, setLoading] = useState(true)

  const range = getDateRange(mode, anchor)

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)

    const membersQuery = user.role === 'Manager'
      ? supabase.rpc('get_manager_downline')
      : supabase.from('users').select('*').eq('sub_account', user.sub_account).order('name')

    const [u, logs, lv, eod] = await Promise.all([
      membersQuery,
      supabase.from('time_logs').select('*').gte('date', range.from).lte('date', range.to),
      supabase.from('leave_requests').select('*').lte('start_date', range.to).gte('end_date', range.from),
      supabase.from('kpi_daily_logs').select('user_id, date, eod_rows').gte('date', range.from).lte('date', range.to),
    ])

    const userList = (u.data as User[] | null) ?? []
    const timeLogs = (logs.data as TimeLog[] | null) ?? []
    const leaveRequests = (lv.data as LeaveRequest[] | null) ?? []
    const kpiDailyLogs = (eod.data as KpiDailyLogRow[] | null) ?? []
    const todayStr = todayInTz(timezone)

    setMembers(userList)
    setReports(userList.map(m => buildUserReport(m, range, timeLogs, leaveRequests, kpiDailyLogs, todayStr)))
    setRawTimeLogs(timeLogs)
    setLoading(false)
  }, [user, range.from, range.to, timezone])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (view === 'individual' && !selectedUserId && members.length > 0) {
      setSelectedUserId(user?.role === 'Staff' ? user.id : members[0].id)
    }
  }, [view, selectedUserId, members, user])

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
          <p className="text-sm text-gray-500 mt-0.5">Attendance, leave, and EODR compliance for payroll and performance review.</p>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between flex-wrap gap-3 bg-white border border-gray-200 rounded-xl px-4 py-3">
        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
          <button
            onClick={() => setView('team')}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${view === 'team' ? 'bg-white text-violet-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            👥 Team View
          </button>
          <button
            onClick={() => setView('individual')}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${view === 'individual' ? 'bg-white text-violet-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            🧑 Individual View
          </button>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
            {MODES.map(m => (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${mode === m.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >
                {m.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setAnchor(a => shiftAnchor(mode, a, -1))} className="w-8 h-8 rounded-full border border-gray-200 flex items-center justify-center hover:bg-gray-50 text-sm">‹</button>
            <span className="text-sm font-medium text-gray-700 min-w-[160px] text-center">{range.label}</span>
            <button onClick={() => setAnchor(a => shiftAnchor(mode, a, 1))} className="w-8 h-8 rounded-full border border-gray-200 flex items-center justify-center hover:bg-gray-50 text-sm">›</button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="py-16 text-center text-sm text-gray-400">Loading report…</div>
      ) : view === 'team' ? (
        <TeamReportView reports={reports} range={range} />
      ) : (
        <IndividualReportView
          reports={reports}
          members={members}
          timeLogs={rawTimeLogs}
          selectedUserId={selectedUserId}
          onSelectUser={setSelectedUserId}
          range={range}
          canPickAnyone={user?.role !== 'Staff'}
        />
      )}
    </div>
  )
}
