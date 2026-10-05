// @ts-nocheck -- reads migration files via node:fs; @types/node is not a project dependency.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'

const MIGRATIONS_DIR = join(__dirname, '../../supabase/migrations')
const LOCK_MIGRATION = '20261006000100_associates_lock.sql'
// Tables associates legitimately touch — scoped by their own rules instead.
const PROJECT_TABLES = ['projects', 'project_members', 'project_tasks', 'project_task_assignees', 'project_task_comments', 'notifications', 'users']

const files = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort()
const read = (f: string) => readFileSync(join(MIGRATIONS_DIR, f), 'utf8')

describe('associate lock', () => {
  it('exists', () => {
    expect(files).toContain(LOCK_MIGRATION)
  })

  it('every table created after the lock migration gets its own *_deny_associates policy', () => {
    const later = files.filter(f => f > LOCK_MIGRATION)
    const allSql = later.map(read).join('\n')
    const created = [...allSql.matchAll(/create table (?:if not exists )?public\.(\w+)/gi)].map(m => m[1])
    const missing = created.filter(t =>
      !PROJECT_TABLES.includes(t) && !new RegExp(`"?${t}_deny_associates"?`, 'i').test(allSql))
    expect(missing).toEqual([])
  })

  it('is_associate() ignores status so suspended associates stay locked out', () => {
    const body = read('20261006000000_associates_role.sql').match(/function public\.is_associate\(\)[\s\S]*?\$\$([\s\S]*?)\$\$/)?.[1] ?? ''
    expect(body).toMatch(/role = 'Associate'/)
    expect(body).not.toMatch(/status/)
  })

  it('pre-request guard only allows project tables and safe RPCs', () => {
    const sql = read(LOCK_MIGRATION)
    const tables = sql.match(/v_path ~ '\^\/\(([^)]+)\)\$'/)?.[1].split('|') ?? []
    const rpcs = sql.match(/v_path ~ '\^\/rpc\/\(([^)]+)\)\$'/)?.[1].split('|') ?? []
    expect(tables.sort()).toEqual([...PROJECT_TABLES].sort())
    expect(rpcs.sort()).toEqual(['check_account_status', 'get_project_member_status', 'is_associate', 'is_project_member'])
  })
})

describe('associate policy performance', () => {
  it('wraps every is_associate() call in a policy as (select ...) so it runs once per statement', () => {
    for (const f of [LOCK_MIGRATION, '20261006000200_associates_project_rules.sql']) {
      const policies = read(f).match(/create policy[\s\S]*?;/gi) ?? []
      expect(policies.length).toBeGreaterThan(0)
      const bare = policies.filter(p => /(?<!\(select )public\.is_associate\(\)/.test(p))
      expect(bare).toEqual([])
    }
  })
})

describe('associate project rules', () => {
  it('limits associates to status-only updates on assigned tasks and blocks create/delete/assign', () => {
    const sql = read('20261006000200_associates_project_rules.sql')
    for (const name of [
      'project_tasks_associate_update', 'project_tasks_associate_no_insert', 'project_tasks_associate_no_delete',
      'project_task_assignees_associate_no_insert', 'project_task_assignees_associate_no_update', 'project_task_assignees_associate_no_delete',
    ]) expect(sql).toContain(name)
    expect(sql).toMatch(/new\.title.*is distinct from.*old\.title/s)
  })
})

describe('project activity notification security', () => {
  it('revokes execute on notify_project_associates and project_actor_name from public/anon/authenticated', () => {
    const sql = read('20261006000300_project_activity_notifications.sql')
    expect(sql).toContain('revoke execute on function public.notify_project_associates(uuid, text, text, uuid) from public, anon, authenticated;')
    expect(sql).toContain('revoke execute on function public.project_actor_name() from public, anon, authenticated;')
  })
})

describe('notification email dispatch resilience', () => {
  it('never lets a dispatch failure roll back the notification insert', () => {
    const sql = read('20261006000400_notification_email_dispatch.sql')
    expect(sql).toContain('exception when others')
    expect(sql).toContain('raise warning')
  })
})
