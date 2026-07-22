export interface ArchiveSnapshot {
  profile: {
    name: string
    email: string
    role: string
    sub_account: string
    country: string
    phone: string | null
    annual_leave: number
    time_off: number
    reporting_time_in: string
    reporting_time_out: string
    member_since: string
  }
  time_logs: Array<{ date: string; status: string; clock_in: string; clock_out: string | null; total_minutes: number }>
  leave_requests: Array<{ type: string; start_date: string; end_date: string; hours: number | null; status: string; reason: string; remarks: string | null }>
  tasks_created: Array<{ title: string; status: string; due_date: string | null; created_at: string }>
  tasks_assigned: Array<{ title: string; status: string; due_date: string | null }>
  kpi_daily_logs: Array<{ date: string; notes: string | null; submitted_at: string }>
  documents: Array<{ title: string; type: string; size: number; created_at: string }>
  eod_reports: Array<{ date: string; body: string }>
}

function section(title: string, count: number, rows: string[]): string {
  const lines = [`${title} (${count})`, '-'.repeat(60)]
  return [...lines, ...(rows.length > 0 ? rows : ['(none)'])].join('\n')
}

export function buildArchiveText(
  snapshot: ArchiveSnapshot,
  archivedByName: string,
  archivedByEmail: string,
  archivedAt: string = new Date().toISOString(),
): string {
  const p = snapshot.profile

  const blocks = [
    ['EMPLOYEE ARCHIVE RECORD', '='.repeat(60), `Archived: ${archivedAt}`, `Archived by: ${archivedByName} (${archivedByEmail})`].join('\n'),
    [
      'PROFILE', '-'.repeat(60),
      `Name: ${p.name}`,
      `Email: ${p.email}`,
      `Role: ${p.role}`,
      `Sub-account: ${p.sub_account}`,
      `Country: ${p.country}`,
      `Phone: ${p.phone ?? '—'}`,
      `Annual leave: ${p.annual_leave} days`,
      `Time-off balance: ${p.time_off} hours`,
      `Work hours: ${p.reporting_time_in}–${p.reporting_time_out}`,
      `Member since: ${p.member_since}`,
    ].join('\n'),
    section('TIME LOGS', snapshot.time_logs.length, snapshot.time_logs.map(t =>
      `${t.date}  ${t.status.padEnd(12)}  ${t.total_minutes}min  ${t.clock_in} → ${t.clock_out ?? 'open'}`
    )),
    section('LEAVE REQUESTS', snapshot.leave_requests.length, snapshot.leave_requests.map(l =>
      `${l.start_date} – ${l.end_date}  ${l.type.padEnd(10)}  ${l.status.padEnd(10)}  ${l.reason}${l.remarks ? ` (${l.remarks})` : ''}`
    )),
    section('TASKS CREATED', snapshot.tasks_created.length, snapshot.tasks_created.map(t =>
      `${t.title}  [${t.status}]  due ${t.due_date ?? '—'}`
    )),
    section('TASKS ASSIGNED', snapshot.tasks_assigned.length, snapshot.tasks_assigned.map(t =>
      `${t.title}  [${t.status}]  due ${t.due_date ?? '—'}`
    )),
    section('KPI DAILY LOGS', snapshot.kpi_daily_logs.length, snapshot.kpi_daily_logs.map(k =>
      `${k.date}${k.notes ? `  ${k.notes}` : ''}`
    )),
    section('DOCUMENTS', snapshot.documents.length, snapshot.documents.map(d =>
      `${d.title}  [${d.type}]  ${d.size} bytes  ${d.created_at}`
    )),
    section('EOD REPORTS', snapshot.eod_reports.length, snapshot.eod_reports.map(e =>
      `${e.date}: ${e.body}`
    )),
  ]

  return blocks.join('\n\n')
}

export function archiveStoragePath(subAccount: string, name: string): string {
  const safeName = name.trim().replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '-')
  return `_archive/${subAccount}/${Date.now()}-${safeName}.txt`
}
