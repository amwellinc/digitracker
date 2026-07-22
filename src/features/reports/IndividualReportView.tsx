import type { DateRange, UserReportRow } from '@/lib/reportData'
import { toCsv, downloadCsv } from '@/lib/reportData'
import type { User, TimeLog } from '@/types'
import { HoursBarChart } from './HoursBarChart'

interface IndividualReportViewProps {
  reports: UserReportRow[]
  members: User[]
  timeLogs: TimeLog[]
  selectedUserId: string
  onSelectUser: (id: string) => void
  range: DateRange
  canPickAnyone: boolean
}

export function IndividualReportView({
  reports, members, timeLogs, selectedUserId, onSelectUser, range, canPickAnyone,
}: IndividualReportViewProps) {
  const report = reports.find(r => r.user.id === selectedUserId)

  const dailyHours = new Map<string, number>()
  for (const log of timeLogs) {
    if (log.user_id !== selectedUserId || log.status !== 'clocked_out') continue
    dailyHours.set(log.date, (dailyHours.get(log.date) ?? 0) + (log.total_minutes ?? 0) / 60)
  }
  const trendData = [...dailyHours.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, hours]) => ({
      label: new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      value: Math.round(hours * 10) / 10,
    }))

  function exportCsv() {
    if (!report) return
    downloadCsv(`${report.user.name.replace(/\s+/g, '-')}-report-${range.from}-to-${range.to}.csv`, toCsv([report]))
  }

  return (
    <div className="space-y-5">
      {/* Person picker */}
      <div className="flex items-center justify-between flex-wrap gap-3 bg-white border border-gray-200 rounded-xl px-4 py-3">
        {canPickAnyone ? (
          <select
            value={selectedUserId}
            onChange={e => onSelectUser(e.target.value)}
            className="text-sm font-medium text-gray-800 border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-violet-500"
          >
            {members.map(m => (
              <option key={m.id} value={m.id}>{m.name} — {m.role}</option>
            ))}
          </select>
        ) : (
          <p className="text-sm font-medium text-gray-800">{report?.user.name ?? 'You'}</p>
        )}
        {report && (
          <button
            onClick={exportCsv}
            className="flex items-center gap-2 text-sm font-medium text-violet-600 border border-violet-200 rounded-lg px-4 py-1.5 hover:bg-violet-50 transition-colors"
          >
            ↓ Export CSV
          </button>
        )}
      </div>

      {!report ? (
        <div className="py-16 text-center text-sm text-gray-400">No data for this person in {range.label}.</div>
      ) : (
        <>
          {/* Stat tiles */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatTile label="Days Worked" value={String(report.daysWorked)} color="text-emerald-600" />
            <StatTile label="Total Hours" value={`${report.totalHours}h`} />
            <StatTile label="Avg Hours/Day" value={`${report.avgHoursPerDay}h`} />
            <StatTile label="Attendance" value={`${report.attendancePct}%`} color={report.attendancePct >= 90 ? 'text-emerald-600' : report.attendancePct >= 70 ? 'text-amber-600' : 'text-red-600'} />
            <StatTile label="On Leave" value={String(report.daysOnLeave)} color="text-blue-600" />
            <StatTile label="Time Off" value={String(report.daysTimeOff)} color="text-cyan-600" />
            <StatTile label="Absent" value={String(report.daysAbsent)} color={report.daysAbsent > 0 ? 'text-red-500' : 'text-gray-900'} />
            <StatTile
              label="EODR Compliance"
              value={`${report.eodrSubmittedDays}/${report.eodrEligibleDays} (${report.eodrCompliancePct}%)`}
              color={report.eodrCompliancePct >= 80 ? 'text-emerald-600' : report.eodrCompliancePct >= 50 ? 'text-amber-600' : 'text-red-600'}
            />
          </div>

          {/* Daily hours trend */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-sm font-semibold text-gray-800 mb-3">Daily Hours — {range.label}</p>
            {trendData.length > 0 ? (
              <HoursBarChart data={trendData} color="#7C3AED" />
            ) : (
              <p className="text-sm text-gray-400 py-8 text-center">No clocked hours recorded in this range.</p>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function StatTile({ label, value, color = 'text-gray-900' }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 px-5 py-4">
      <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">{label}</p>
      <p className={`text-xl font-bold ${color}`}>{value}</p>
    </div>
  )
}
