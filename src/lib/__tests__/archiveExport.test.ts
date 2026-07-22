import { describe, it, expect } from 'vitest'
import { buildArchiveText, archiveStoragePath, type ArchiveSnapshot } from '../archiveExport'

const emptySnapshot: ArchiveSnapshot = {
  profile: {
    name: 'Jane Doe', email: 'jane@test.com', role: 'Staff', sub_account: 'AM333',
    country: 'SG', phone: '91234567', annual_leave: 14, time_off: 40,
    reporting_time_in: '10:00', reporting_time_out: '19:00', member_since: '2026-01-01T00:00:00Z',
  },
  time_logs: [], leave_requests: [], tasks_created: [], tasks_assigned: [],
  kpi_daily_logs: [], documents: [], eod_reports: [],
}

describe('buildArchiveText', () => {
  it('includes the archived-by attribution and profile fields', () => {
    const text = buildArchiveText(emptySnapshot, 'Admin User', 'admin@test.com', '2026-06-01T00:00:00Z')
    expect(text).toContain('Archived by: Admin User (admin@test.com)')
    expect(text).toContain('Name: Jane Doe')
    expect(text).toContain('Email: jane@test.com')
    expect(text).toContain('Sub-account: AM333')
  })

  it('shows "(none)" for empty sections', () => {
    const text = buildArchiveText(emptySnapshot, 'Admin', 'admin@test.com')
    expect(text).toContain('TIME LOGS (0)')
    expect(text).toContain('LEAVE REQUESTS (0)')
  })

  it('lists populated section entries', () => {
    const snapshot: ArchiveSnapshot = {
      ...emptySnapshot,
      leave_requests: [{ type: 'Annual', start_date: '2026-01-05', end_date: '2026-01-06', hours: null, status: 'approved', reason: 'Trip', remarks: null }],
    }
    const text = buildArchiveText(snapshot, 'Admin', 'admin@test.com')
    expect(text).toContain('LEAVE REQUESTS (1)')
    expect(text).toContain('Trip')
    expect(text).toContain('approved')
  })
})

describe('archiveStoragePath', () => {
  it('builds a path scoped under _archive/<sub_account>/ with a sanitized filename', () => {
    const path = archiveStoragePath('AM333', "Jane O'Doe!!")
    expect(path).toMatch(/^_archive\/AM333\/\d+-Jane-ODoe\.txt$/)
  })
})
