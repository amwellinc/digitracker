import { describe, it, expect } from 'vitest'
import { getDateRange, buildUserReport, toCsv, type KpiDailyLogRow } from '../reportData'
import type { User, TimeLog, LeaveRequest } from '@/types'

describe('getDateRange', () => {
  it('returns Monday–Sunday for a week anchored mid-week', () => {
    const range = getDateRange('week', new Date(2026, 0, 7)) // Wed, Jan 7 2026
    expect(range.from).toBe('2026-01-05')
    expect(range.to).toBe('2026-01-11')
  })

  it('returns the same Monday–Sunday when anchored on the Sunday itself', () => {
    const range = getDateRange('week', new Date(2026, 0, 11)) // Sun, Jan 11 2026
    expect(range.from).toBe('2026-01-05')
    expect(range.to).toBe('2026-01-11')
  })

  it('returns the same Monday–Sunday when anchored on the Monday itself', () => {
    const range = getDateRange('week', new Date(2026, 0, 5)) // Mon, Jan 5 2026
    expect(range.from).toBe('2026-01-05')
    expect(range.to).toBe('2026-01-11')
  })

  it('returns first–last day of month', () => {
    const range = getDateRange('month', new Date(2026, 1, 15)) // Feb 15 2026 (not a leap year)
    expect(range.from).toBe('2026-02-01')
    expect(range.to).toBe('2026-02-28')
  })

  it('returns a single day for day mode', () => {
    const range = getDateRange('day', new Date(2026, 0, 7))
    expect(range.from).toBe('2026-01-07')
    expect(range.to).toBe('2026-01-07')
  })
})

describe('buildUserReport', () => {
  const user: User = {
    id: 'u1', email: 'staff@test.com', name: 'Test Staff', role: 'Staff',
    sub_account: 'AM333', manager_id: null, annual_leave: 14, time_off: 40,
    profile_image: null, reporting_time_in: '10:00', reporting_time_out: '19:00',
    country: 'SG', phone: null, status: 'active', created_at: new Date().toISOString(),
    appointed_as: null, address_line1: null, address_line2: null, address_city: null, address_pin_code: null,
    last_ip_address: null, last_ip_captured_at: null, emergency_contact_name: null, emergency_contact_phone: null,
    department_id: null,
  }

  // Mon Jan 5 – Sun Jan 11, 2026. Weekdays: 5,6,7,8,9.
  const range = getDateRange('week', new Date(2026, 0, 7))
  const todayStr = '2026-01-12' // the following Monday — whole week has elapsed

  const timeLogs: TimeLog[] = [
    { id: 't1', user_id: 'u1', date: '2026-01-05', clock_in: '2026-01-05T02:00:00Z', clock_out: '2026-01-05T10:00:00Z', status: 'clocked_out', total_minutes: 480, last_seen_at: null },
    { id: 't2', user_id: 'u1', date: '2026-01-06', clock_in: '2026-01-06T02:00:00Z', clock_out: '2026-01-06T10:00:00Z', status: 'clocked_out', total_minutes: 480, last_seen_at: null },
  ]

  const leaveRequests: LeaveRequest[] = [
    { id: 'l1', user_id: 'u1', type: 'Annual', start_date: '2026-01-07', end_date: '2026-01-07', hours: null, reason: 'Personal', status: 'approved', remarks: null, created_at: '' },
    { id: 'l2', user_id: 'u1', type: 'Time-off', start_date: '2026-01-08', end_date: '2026-01-08', hours: null, reason: 'Errand', status: 'approved', remarks: null, created_at: '' },
  ]

  const kpiDailyLogs: KpiDailyLogRow[] = [
    { user_id: 'u1', date: '2026-01-05', eod_rows: [{ task: 'Shipped feature X', remarks: '' }] },
    { user_id: 'u1', date: '2026-01-06', eod_rows: [] }, // worked but no EODR
  ]

  it('counts days worked and total hours from clocked-out time logs', () => {
    const report = buildUserReport(user, range, timeLogs, leaveRequests, kpiDailyLogs, todayStr)
    expect(report.daysWorked).toBe(2)
    expect(report.totalHours).toBe(16)
    expect(report.avgHoursPerDay).toBe('8.0')
  })

  it('separates On Leave from Time Off', () => {
    const report = buildUserReport(user, range, timeLogs, leaveRequests, kpiDailyLogs, todayStr)
    expect(report.daysOnLeave).toBe(1)
    expect(report.daysTimeOff).toBe(1)
  })

  it('counts the remaining elapsed weekday as absent', () => {
    // 5 elapsed weekdays - 2 worked - 1 leave - 1 time-off = 1 absent (Jan 9)
    const report = buildUserReport(user, range, timeLogs, leaveRequests, kpiDailyLogs, todayStr)
    expect(report.daysAbsent).toBe(1)
  })

  it('computes EODR compliance only against days a report was plausible', () => {
    const report = buildUserReport(user, range, timeLogs, leaveRequests, kpiDailyLogs, todayStr)
    expect(report.eodrSubmittedDays).toBe(1)
    expect(report.eodrEligibleDays).toBe(3) // 2 worked + 1 absent
    expect(report.eodrCompliancePct).toBe(33)
  })

  it('computes attendance percentage against elapsed workdays', () => {
    const report = buildUserReport(user, range, timeLogs, leaveRequests, kpiDailyLogs, todayStr)
    expect(report.attendancePct).toBe(40) // 2 of 5 elapsed weekdays
  })

  it('does not count weekend days toward elapsed workdays or absence', () => {
    const fullMonthRange = { from: '2026-01-01', to: '2026-01-11', label: 'test' }
    const report = buildUserReport(user, fullMonthRange, timeLogs, leaveRequests, kpiDailyLogs, todayStr)
    // Jan 1-4 2026 is Thu/Fri/Sat/Sun -> 2 extra weekdays (Jan1 Thu, Jan2 Fri) with no data => absent
    // Total elapsed weekdays: Jan1,2,5,6,7,8,9 = 7. Worked 2, leave 1, timeoff 1 => absent 3.
    expect(report.daysAbsent).toBe(3)
  })
})

describe('toCsv', () => {
  it('produces a header row and one row per user report', () => {
    const user: User = {
      id: 'u1', email: 'a@test.com', name: 'A Name', role: 'Staff', sub_account: 'AM333',
      manager_id: null, annual_leave: 14, time_off: 40, profile_image: null,
      reporting_time_in: '10:00', reporting_time_out: '19:00', country: 'SG', phone: null,
      status: 'active', created_at: '',
      appointed_as: null, address_line1: null, address_line2: null, address_city: null, address_pin_code: null,
      last_ip_address: null, last_ip_captured_at: null, emergency_contact_name: null, emergency_contact_phone: null,
      department_id: null,
    }
    const csv = toCsv([{
      user, daysWorked: 5, totalMinutes: 2400, totalHours: 40, avgHoursPerDay: '8.0',
      daysOnLeave: 0, daysTimeOff: 0, daysAbsent: 0, eodrSubmittedDays: 5, eodrEligibleDays: 5,
      eodrCompliancePct: 100, attendancePct: 100,
    }])
    const lines = csv.split('\n')
    expect(lines[0]).toContain('Name,Role,Days Worked')
    expect(lines[1]).toContain('"A Name"')
    expect(lines[1]).toContain('100')
  })
})
