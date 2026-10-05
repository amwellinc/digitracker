// scripts/verify-associate-lock.mjs
// Usage: SUPABASE_URL=... SUPABASE_ANON_KEY=... ASSOC_EMAIL=... ASSOC_PASSWORD=... \
//        PROJECT_ID=<their project> OTHER_PROJECT_ID=<not theirs> ASSIGNED_TASK_ID=... UNASSIGNED_TASK_ID=... \
//        node scripts/verify-associate-lock.mjs
import { createClient } from '@supabase/supabase-js'

const env = (k) => { const v = process.env[k]; if (!v) throw new Error(`${k} is required`); return v }
const sb = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'))
const { error: loginErr } = await sb.auth.signInWithPassword({ email: env('ASSOC_EMAIL'), password: env('ASSOC_PASSWORD') })
if (loginErr) throw loginErr

let failures = 0
const check = (label, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} ${detail}`); if (!ok) failures++ }

for (const table of ['time_logs', 'leave_requests', 'tasks', 'documents', 'payroll_entries', 'sub_accounts']) {
  const { data, error } = await sb.from(table).select('*').limit(1)
  check(`cannot read ${table}`, !!error || (data ?? []).length === 0, error?.message ?? '')
}
for (const rpc of ['get_team_status', 'debug_data_isolation', 'get_manager_downline']) {
  const { error } = await sb.rpc(rpc, {})
  check(`cannot call rpc ${rpc}`, !!error && /associates/i.test(error.message), error?.message ?? 'no error')
}
const own = await sb.from('projects').select('id').eq('id', env('PROJECT_ID'))
check('can read own project', (own.data ?? []).length === 1)
const other = await sb.from('projects').select('id').eq('id', env('OTHER_PROJECT_ID'))
check('cannot read other project', (other.data ?? []).length === 0)

const statusOk = await sb.from('project_tasks').update({ status: 'in_progress' }).eq('id', env('ASSIGNED_TASK_ID')).select('id')
check('can change status of assigned task', !statusOk.error && (statusOk.data ?? []).length === 1, statusOk.error?.message ?? '')
const titleBad = await sb.from('project_tasks').update({ title: 'hacked' }).eq('id', env('ASSIGNED_TASK_ID'))
check('cannot change title', !!titleBad.error, titleBad.error?.message ?? 'no error')
const unassigned = await sb.from('project_tasks').update({ status: 'in_progress' }).eq('id', env('UNASSIGNED_TASK_ID')).select('id')
check('cannot update unassigned task', !!unassigned.error || (unassigned.data ?? []).length === 0)
const ins = await sb.from('project_tasks').insert({ project_id: env('PROJECT_ID'), title: 'x', creator_id: '00000000-0000-0000-0000-000000000000' })
check('cannot create task', !!ins.error, ins.error?.message ?? 'no error')
const del = await sb.from('project_tasks').delete().eq('id', env('ASSIGNED_TASK_ID')).select('id')
check('cannot delete task', !!del.error || (del.data ?? []).length === 0)
const up = await sb.storage.from('task-attachments').upload(`${env('UNASSIGNED_TASK_ID')}-not-a-folder/x.txt`, new Blob(['x']))
check('cannot upload outside project task folders', !!up.error, up.error?.message ?? 'no error')

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed')
process.exit(failures ? 1 : 0)
