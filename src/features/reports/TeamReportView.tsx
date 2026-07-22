import type { DateRange, UserReportRow } from '@/lib/reportData'
import { toCsv, downloadCsv } from '@/lib/reportData'
import { HoursBarChart } from './HoursBarChart'
import { DayStatusStackedBar, type DayStatusDatum } from './DayStatusStackedBar'

export function TeamReportView({ reports, range }: { reports: UserReportRow[]; range: DateRange }) {
  const teamTotalHours = reports.reduce((s, r) => s + r.totalHours, 0)
  const teamOnLeave = reports.reduce((s, r) => s + r.daysOnLeave, 0)
  const teamTimeOff = reports.reduce((s, r) => s + r.daysTimeOff, 0)
  const eligibleTotal = reports.reduce((s, r) => s + r.eodrEligibleDays, 0)
  const submittedTotal = reports.reduce((s, r) => s + r.eodrSubmittedDays, 0)
  const teamEodrPct = eligibleTotal > 0 ? Math.round((submittedTotal / eligibleTotal) * 100) : 0

  const hoursData = reports.map(r => ({ label: r.user.name.split(' ')[0], value: r.totalHours }))
  const dayStatusData: DayStatusDatum[] = reports.map(r => ({
    label: r.user.name,
    present: r.daysWorked,
    onLeave: r.daysOnLeave,
    timeOff: r.daysTimeOff,
    absent: r.daysAbsent,
  }))

  function exportCsv() {
    downloadCsv(`team-report-${range.from}-to-${range.to}.csv`, toCsv(reports))
  }

  return (
    <div className="space-y-5">
      {/* Stat tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatTile label="Team Members" value={String(reports.length)} />
        <StatTile label="Total Hours" value={`${teamTotalHours}h`} color="text-emerald-600" />
        <StatTile label="On Leave / Time Off" value={`${teamOnLeave} / ${teamTimeOff}`} color="text-blue-600" />
        <StatTile label="EODR Compliance" value={`${teamEodrPct}%`} color={teamEodrPct >= 80 ? 'text-emerald-600' : teamEodrPct >= 50 ? 'text-amber-600' : 'text-red-600'} />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-sm font-semibold text-gray-800 mb-3">Hours per Team Member</p>
          <HoursBarChart data={hoursData} color="#7C3AED" />
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-sm font-semibold text-gray-800 mb-3">Attendance Breakdown</p>
          <DayStatusStackedBar data={dayStatusData} />
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
          <p className="text-sm font-semibold text-gray-800">Detail — {range.label}</p>
          <button
            onClick={exportCsv}
            className="flex items-center gap-2 text-sm font-medium text-violet-600 border border-violet-200 rounded-lg px-4 py-1.5 hover:bg-violet-50 transition-colors"
          >
            ↓ Export CSV
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Member</th>
                <th className="text-center px-3 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Days Worked</th>
                <th className="text-center px-3 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Hours</th>
                <th className="text-center px-3 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Avg/Day</th>
                <th className="text-center px-3 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">On Leave</th>
                <th className="text-center px-3 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Time Off</th>
                <th className="text-center px-3 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Absent</th>
                <th className="text-center px-3 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">EODR</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Attendance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {reports.map(r => (
                <tr key={r.user.id} className="hover:bg-gray-50/50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{r.user.name}</p>
                    <p className="text-xs text-gray-400">{r.user.role}</p>
                  </td>
                  <td className="px-3 py-3 text-center font-semibold text-emerald-700">{r.daysWorked}</td>
                  <td className="px-3 py-3 text-center font-semibold text-gray-700">{r.totalHours}h</td>
                  <td className="px-3 py-3 text-center text-gray-600">{r.avgHoursPerDay}h</td>
                  <td className="px-3 py-3 text-center">{r.daysOnLeave > 0 ? <span className="text-blue-600 font-semibold">{r.daysOnLeave}</span> : <span className="text-gray-300">—</span>}</td>
                  <td className="px-3 py-3 text-center">{r.daysTimeOff > 0 ? <span className="text-cyan-600 font-semibold">{r.daysTimeOff}</span> : <span className="text-gray-300">—</span>}</td>
                  <td className="px-3 py-3 text-center">{r.daysAbsent > 0 ? <span className="text-red-500 font-semibold">{r.daysAbsent}</span> : <span className="text-emerald-500 font-semibold">0</span>}</td>
                  <td className="px-3 py-3 text-center">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                      r.eodrCompliancePct >= 80 ? 'bg-emerald-50 text-emerald-700' : r.eodrCompliancePct >= 50 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-600'
                    }`}>
                      {r.eodrSubmittedDays}/{r.eodrEligibleDays}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${r.attendancePct >= 90 ? 'bg-emerald-500' : r.attendancePct >= 70 ? 'bg-amber-400' : 'bg-red-400'}`} style={{ width: `${r.attendancePct}%` }} />
                      </div>
                      <span className="text-xs font-bold text-gray-600 w-9 text-right">{r.attendancePct}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function StatTile({ label, value, color = 'text-gray-900' }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 px-5 py-4">
      <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
    </div>
  )
}
