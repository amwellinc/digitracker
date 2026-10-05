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
