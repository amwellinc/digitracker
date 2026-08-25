// Super-Admin-only: permanently deletes an entire sub-account (tenant) —
// every user in it, everything those users own, the sub-account's own
// records, and their Auth logins. Irreversible. Same auth pattern as the
// other admin-*/ghl-* edge functions: verify the caller's session, then
// check their role before doing anything.
//
// Deliberately does NOT go through archive_and_delete_user() (the
// per-employee offboarding path used by Settings > Users) — that path
// exists to preserve an audit trail for an individual leaving an ongoing
// company, one archive file at a time. This function is for removing an
// entire tenant outright (test/spam signups, an offboarded customer who
// wants their data gone) — there is no "company" left afterward for an
// audit trail to serve.
//
// public.users.sub_account and most sub-account-scoped tables (subscriptions,
// message_board_posts, public_holidays) are plain text columns with no FK to
// sub_accounts — a DB cascade never reaches them, so each is deleted
// explicitly. Everything hanging off a user_id (time_logs, tasks, leave
// requests, documents, kpis, etc.) cascades automatically once the user rows
// are deleted (confirmed: every FK to users(id) in the schema is either ON
// DELETE CASCADE or ON DELETE SET NULL — nothing blocks this). Deleting the
// sub_accounts row itself then cascades ghl_installations, ghl_contact_links,
// and departments, which do have a real FK.
//
// archived_employee_files and payment_transactions are intentionally left
// alone: both were designed (migrations 027 and 023) to survive exactly this
// — HR/financial records that should outlive the tenant, not disappear with
// it. payment_transactions.sub_account is ON DELETE SET NULL for that reason.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Mirrors Settings > Users' purgeUserStorageFiles — files live in Storage,
// not the database, so a row cascade never touches them. Same bucket scope
// as that established helper (documents, screenshots); leave-documents is
// also keyed by `<user_id>/…` so it's included too.
const USER_STORAGE_BUCKETS = ['documents', 'screenshots', 'leave-documents'] as const

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  })
}

interface RequestBody {
  subAccountCode: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'Missing authorization header' }, 401)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey     = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: { user: callerAuthUser }, error: callerErr } = await callerClient.auth.getUser()
  if (callerErr || !callerAuthUser?.email) return json({ error: 'Invalid session' }, 401)

  const admin = createClient(supabaseUrl, serviceKey)

  const { data: callerRow } = await admin
    .from('users')
    .select('role')
    .ilike('email', callerAuthUser.email)
    .maybeSingle()

  if (!callerRow || callerRow.role !== 'Super-Admin') {
    return json({ error: 'Only Super-Admins can delete a sub-account.' }, 403)
  }

  let body: RequestBody
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }
  const subAccountCode = (body.subAccountCode ?? '').trim()
  if (!subAccountCode) return json({ error: 'subAccountCode is required.' }, 400)

  const { data: subAccount } = await admin
    .from('sub_accounts')
    .select('code, company_name')
    .eq('code', subAccountCode)
    .maybeSingle()
  if (!subAccount) return json({ error: 'No sub-account found with that code.' }, 404)

  const { data: members } = await admin
    .from('users')
    .select('id, email')
    .eq('sub_account', subAccountCode)
  const users = (members ?? []) as { id: string; email: string }[]

  // ── Best-effort Storage purge, per user, before the rows that reference
  //    them disappear. A failure here must never block the actual deletion
  //    — an orphaned file is a cleanup nit, a half-deleted tenant is not.
  const storageErrors: string[] = []
  for (const u of users) {
    for (const bucket of USER_STORAGE_BUCKETS) {
      try {
        const { data: files } = await admin.storage.from(bucket).list(u.id, { limit: 1000 })
        if (files && files.length > 0) {
          const paths = files.map(f => `${u.id}/${f.name}`)
          const { error: removeErr } = await admin.storage.from(bucket).remove(paths)
          if (removeErr) storageErrors.push(`${bucket}/${u.id}: ${removeErr.message}`)
        }
      } catch (err) {
        storageErrors.push(`${bucket}/${u.id}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }

  // ── Delete every user row — cascades all their owned data (time logs,
  //    tasks, leave requests, documents, kpis, screenshots rows, etc.).
  const { error: usersDelErr } = await admin.from('users').delete().eq('sub_account', subAccountCode)
  if (usersDelErr) return json({ error: `Failed to delete users: ${usersDelErr.message}` }, 500)

  // ── Remove the Auth logins. Best-effort per user — an already-missing
  //    Auth account (a prior partial failure) must not abort the rest.
  const authErrors: string[] = []
  for (const u of users) {
    const { error } = await admin.auth.admin.deleteUser(u.id)
    if (error) authErrors.push(`${u.email}: ${error.message}`)
  }

  // ── Sub-account-scoped tables with no FK to sub_accounts, so no cascade
  //    reaches them from the delete below.
  await admin.from('subscriptions').delete().eq('sub_account', subAccountCode)
  await admin.from('message_board_posts').delete().eq('sub_account', subAccountCode)
  await admin.from('public_holidays').delete().eq('sub_account', subAccountCode)

  // ── Finally the sub_accounts row — cascades ghl_installations,
  //    ghl_contact_links, and departments via their real FK.
  const { error: saDelErr } = await admin.from('sub_accounts').delete().eq('code', subAccountCode)
  if (saDelErr) return json({ error: `Deleted all data but failed to remove the sub-account row: ${saDelErr.message}` }, 500)

  return json({
    success: true,
    deletedUsers: users.length,
    authErrors,
    storageErrors,
  })
})
