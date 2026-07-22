import type { User, TimeLog, LeaveRequest } from '@/types'

export type ReportRangeMode = 'day' | 'week' | 'month'

export interface DateRange {
  from: string   // inclusive, YYYY-MM-DD
  to: string     // inclusive, YYYY-MM-DD
  label: string
}

export interface KpiDailyLogRow {
  user_id: string
  date: string
  eod_rows: Array<{ task: string; remarks: string }>
}

export interface UserReportRow {
  user: User
  daysWorked: number
  totalMinutes: number
  totalHours: number
  avgHoursPerDay: string
  daysOnLeave: number      // Annual + Medical
  daysTimeOff: number      // Time-off type specifically
  daysAbsent: number
  eodrSubmittedDays: number
  eodrEligibleDays: number // workdays elapsed so far in range that the person worked or should have
  eodrCompliancePct: number
  attendancePct: number
}

function pad2(n: number): string { return String(n).padStart(2, '0') }

// Local-timezone date components — toISOString() is UTC and shifts the date
// for anyone in a UTC+ zone, which silently misattributes a day's records.
export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

export function isWeekend(d: Date): boolean {
  const day = d.getDay()
  return day === 0 || day === 6
}

// anchor: any Date within the desired range. Week runs Monday–Sunday.
export function getDateRange(mode: ReportRangeMode, anchor: Date): DateRange {
  if (mode === 'day') {
    const iso = isoDate(anchor)
    return { from: iso, to: iso, label: anchor.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) }
  }
  if (mode === 'week') {
    const day = anchor.getDay() // 0=Sun..6=Sat
    const mondayOffset = day === 0 ? -6 : 1 - day
    const monday = new Date(anchor)
    monday.setDate(anchor.getDate() + mondayOffset)
    const sunday = new Date(monday)
    sunday.setDate(monday.getDate() + 6)
    const label = `${monday.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${sunday.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
    return { from: isoDate(monday), to: isoDate(sunday), label }
  }
  // month
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
  const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0)
  const label = anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  return { from: isoDate(first), to: isoDate(last), label }
}

export function shiftAnchor(mode: ReportRangeMode, anchor: Date, direction: 1 | -1): Date {
  const next = new Date(anchor)
  if (mode === 'day') next.setDate(next.getDate() + direction)
  else if (mode === 'week') next.setDate(next.getDate() + direction * 7)
  else next.setMonth(next.getMonth() + direction)
  return next
}

// Every calendar date in [from, to], inclusive, as Date objects.
function eachDate(from: string, to: string): Date[] {
  const out: Date[] = []
  const cur = new Date(`${from}T00:00:00`)
  const end = new Date(`${to}T00:00:00`)
  while (cur <= end) {
    out.push(new Date(cur))
    cur.setDate(cur.getDate() + 1)
  }
  return out
}

export function buildUserReport(
  user: User,
  range: DateRange,
  timeLogs: TimeLog[],
  leaveRequests: LeaveRequest[],
  kpiDailyLogs: KpiDailyLogRow[],
  todayStr: string,
): UserReportRow {
  const userLogs = timeLogs.filter(l => l.user_id === user.id && l.status === 'clocked_out')
  const userLeaves = leaveRequests.filter(l => l.user_id === user.id && l.status === 'approved')
  const userEod = kpiDailyLogs.filter(l => l.user_id === user.id)

  const totalMinutes = userLogs.reduce((s, l) => s + (l.total_minutes ?? 0), 0)
  const daysWorked = new Set(userLogs.map(l => l.date)).size

  const days = eachDate(range.from, range.to)
  let daysOnLeave = 0
  let daysTimeOff = 0
  let elapsedWorkdays = 0
  let eodrSubmittedDays = 0

  for (const d of days) {
    if (isWeekend(d)) continue
    const dateStr = isoDate(d)
    if (dateStr > todayStr) continue
    elapsedWorkdays++

    const leaveToday = userLeaves.find(l => l.start_date <= dateStr && l.end_date >= dateStr)
    if (leaveToday?.type === 'Time-off') daysTimeOff++
    else if (leaveToday) daysOnLeave++

    const eod = userEod.find(e => e.date === dateStr)
    if (eod && eod.eod_rows.some(r => r.task?.trim())) eodrSubmittedDays++
  }

  const daysAbsent = Math.max(0, elapsedWorkdays - daysWorked - daysOnLeave - daysTimeOff)
  const avgHoursPerDay = daysWorked > 0 ? (totalMinutes / daysWorked / 60).toFixed(1) : '0.0'
  const eodrEligibleDays = Math.min(elapsedWorkdays, daysWorked + daysAbsent) // days a report could plausibly have been filed
  const eodrCompliancePct = eodrEligibleDays > 0 ? Math.round((eodrSubmittedDays / eodrEligibleDays) * 100) : 0
  const attendancePct = elapsedWorkdays > 0 ? Math.round((daysWorked / elapsedWorkdays) * 100) : 0

  return {
    user,
    daysWorked,
    totalMinutes,
    totalHours: Math.round((totalMinutes / 60) * 10) / 10,
    avgHoursPerDay,
    daysOnLeave,
    daysTimeOff,
    daysAbsent,
    eodrSubmittedDays,
    eodrEligibleDays,
    eodrCompliancePct,
    attendancePct,
  }
}

export function toCsv(rows: UserReportRow[]): string {
  const header = 'Name,Role,Days Worked,Total Hours,Avg Hours/Day,On Leave,Time Off,Absent,EODR Submitted,EODR Compliance %,Attendance %'
  const lines = rows.map(r => [
    `"${r.user.name}"`, r.user.role, r.daysWorked, r.totalHours, r.avgHoursPerDay,
    r.daysOnLeave, r.daysTimeOff, r.daysAbsent, r.eodrSubmittedDays, r.eodrCompliancePct, r.attendancePct,
  ].join(','))
  return [header, ...lines].join('\n')
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
