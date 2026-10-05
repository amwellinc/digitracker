// @ts-nocheck -- reads migration files via node:fs; @types/node is not a project dependency.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'

const MIGRATIONS_DIR = join(__dirname, '../../supabase/migrations')
const LOCK_MIGRATION = '20261006000100_associates_lock.sql'
// Tables associates legitimately touch — scoped by their own rules instead.
const PROJECT_TABLES = ['projects', 'project_members', 'project_tasks', 'project_task_assignees', 'project_task_comments', 'notifications', 'users', 'project_folders', 'project_files']

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
    const definers = files.filter(f => /function public\.associate_request_guard\(\)/.test(read(f)))
    const sql = read(definers[definers.length - 1])
    const tables = sql.match(/v_path ~ '\^\/\(([^)]+)\)\$'/)?.[1].split('|') ?? []
    const rpcs = sql.match(/v_path ~ '\^\/rpc\/\(([^)]+)\)\$'/)?.[1].split('|') ?? []
    expect(tables.sort()).toEqual([...PROJECT_TABLES].sort())
    expect(rpcs.sort()).toEqual(['check_account_status', 'ensure_task_root_folder', 'get_project_member_status', 'is_associate', 'is_project_member'])
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

  it('notifies internal task participants only when the actor is an associate (no double-notify)', () => {
    const sql = read('20261006000300_project_activity_notifications.sql')
    expect(sql).toContain('revoke execute on function public.notify_task_internal_members(uuid, text, text, boolean) from public, anon, authenticated;')
    const calls = [...sql.matchAll(/if public\.is_associate\(\) then\s+--[^\n]*\n\s+perform public\.notify_task_internal_members\(/g)]
    expect(calls).toHaveLength(2)
    expect(sql.match(/perform public\.notify_task_internal_members\(/g)).toHaveLength(2)
    expect(sql).toContain(`'task_reply'`)
    expect(sql).toMatch(/'task_completed'[\s\S]*'task_closed'[\s\S]*'task_assigned'/)
  })
})

describe('notification email dispatch resilience', () => {
  it('never lets a dispatch failure roll back the notification insert', () => {
    const sql = read('20261006000400_notification_email_dispatch.sql')
    expect(sql).toContain('exception when others')
    expect(sql).toContain('raise warning')
  })
})

describe('notification email dispatch timeout', () => {
  it('gives the email function longer than pg_net\'s 5s default (SMTP send exceeds it)', () => {
    const sql = read('20261006000500_notification_email_dispatch_timeout.sql')
    expect(sql).toMatch(/timeout_milliseconds\s*:=\s*30000/)
    expect(sql).toContain('exception when others')
  })
})

describe('project files security', () => {
  const sql = () => read('20261006000600_project_files.sql')
  it('casts storage path segments with try_uuid, never a bare ::uuid', () => {
    expect(sql()).toMatch(/function public\.try_uuid\(/)
    expect(sql()).not.toMatch(/\(storage\.foldername\(name\)\)\[1\]\)?::uuid/)
  })
  it('creates member-only policies on both tables and the bucket', () => {
    for (const p of ['project_folders_select', 'project_folders_insert', 'project_folders_update', 'project_folders_delete',
      'project_files_select', 'project_files_insert', 'project_files_update', 'project_files_delete',
      'project_files_obj_select', 'project_files_obj_insert', 'project_files_obj_delete']) expect(sql()).toContain(p)
  })
  it('lets the uploader remove an orphaned object whose row insert failed', () => {
    const m = sql().match(/create policy project_files_obj_delete[\s\S]*?;\n/)
    expect(m?.[0]).toContain('owner = auth.uid()')
  })
  it('lets associates reach project-files objects of their projects', () => {
    expect(sql()).toMatch(/storage_associate_scope[\s\S]*bucket_id = 'project-files'/)
  })
  it('releases files before a task is deleted, limits update columns, and checks insert integrity', () => {
    for (const frag of ['project_tasks_release_files', 'grant update (name) on public.project_folders',
      'grant update (name, folder_id, task_id) on public.project_files',
      "split_part(storage_path, '/', 1) = project_id::text"]) expect(sql()).toContain(frag)
  })
})

describe('project files import', () => {
  const sql = () => read('20261006000700_project_files_import.sql')
  it('is idempotent and only imports objects that still exist', () => {
    expect(sql().match(/on conflict \(bucket, storage_path\) do nothing/g)).toHaveLength(2)
    expect(sql().match(/from storage\.objects o\s+where o\.bucket_id = 'task-attachments'/g)).toHaveLength(2)
    expect(sql()).toContain("'import'")
  })
  it('decodes URL paths with a null-on-error url_decode', () => {
    expect(sql()).toMatch(/function public\.url_decode\(/)
    expect(sql()).toMatch(/exception when others then\s+return null/)
  })
  it('truncates names to 255 chars and validates size_bytes regex', () => {
    expect(sql().match(/left\(coalesce\(nullif\(trim\(a->>'name'\), ''\), p\.path\), 255\)/g)).toHaveLength(2)
    expect(sql().match(/a->>'size'.*~.*1,15/g)).toHaveLength(2)
  })
})
