// Lets an Admin (or Super-Admin) change another user's sign-in email. Runs
// entirely server-side: updating a Supabase Auth user's email requires the
// service-role key, which must never reach the browser.
//
// Also keeps the Auth email and public.users.email in lockstep — RLS's
// auth_user_*() helpers match on LOWER(email) = LOWER(auth.email()), so if
// these two ever diverge the affected user is locked out of every
// RLS-protected query until it's fixed. Order matters here:
//   1. Reject a duplicate/unchanged email up front (public.users.email has a
//      hard unique constraint; catching it here gives a clean error instead
//      of a raw Postgres one, and avoids touching Auth for nothing).
//   2. Update Auth first. If it fails, we return before touching
//      public.users at all, so the two can never diverge from a failed Auth
//      call.
//   3. Update public.users.email only after Auth succeeded.
//
// Deployed WITHOUT --no-verify-jwt — see admin-set-password for why the
// role/ownership check below is still required as a second layer.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendEmailChangedNotice } from '../_shared/accountEmails.ts'

interface RequestBody {
  targetUserId: string
  newEmail: string
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  })
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'Missing authorization header' }, 401)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  // Scoped to the caller's own JWT — used only to cryptographically confirm who is calling.
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: { user: callerAuthUser }, error: callerErr } = await callerClient.auth.getUser()
  if (callerErr || !callerAuthUser?.email) return json({ error: 'Invalid session' }, 401)

  let body: RequestBody
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }
  const targetUserId = body.targetUserId
  const newEmail = (body.newEmail ?? '').trim().toLowerCase()

  if (!targetUserId || typeof targetUserId !== 'string') {
    return json({ error: 'targetUserId is required' }, 400)
  }
  if (!newEmail || !EMAIL_RE.test(newEmail)) {
    return json({ error: 'A valid email address is required' }, 400)
  }

  // Service-role client — bypasses RLS deliberately; the authorization checks
  // below ARE the security boundary for this function.
  const admin = createClient(supabaseUrl, serviceKey)

  const { data: callerRow } = await admin
    .from('users')
    .select('role, sub_account')
    .ilike('email', callerAuthUser.email)
    .maybeSingle()

  if (!callerRow || !['Admin', 'Super-Admin'].includes(callerRow.role as string)) {
    return json({ error: "Only Admins can change another user's email" }, 403)
  }

  const { data: targetRow } = await admin
    .from('users')
    .select('id, name, email, sub_account')
    .eq('id', targetUserId)
    .maybeSingle()

  if (!targetRow) return json({ error: 'User not found' }, 404)

  if (callerRow.role !== 'Super-Admin' && targetRow.sub_account !== callerRow.sub_account) {
    return json({ error: 'You can only manage users in your own workspace' }, 403)
  }

  const oldEmail = targetRow.email as string
  if (newEmail === oldEmail.toLowerCase()) {
    return json({ error: "That is already this user's email." }, 400)
  }

  const { data: existing } = await admin
    .from('users')
    .select('id')
    .ilike('email', newEmail)
    .maybeSingle()
  if (existing && existing.id !== targetUserId) {
    return json({ error: 'That email is already used by another account.' }, 409)
  }

  // Find the underlying Supabase Auth account under the OLD email, if one
  // already exists (e.g. the user never completed a magic-link sign-in yet,
  // in which case there's nothing on the Auth side to update).
  let authUserId: string | null = null
  for (let page = 1; ; page++) {
    const { data: pageData, error: listErr } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (listErr) return json({ error: listErr.message }, 500)
    const match = pageData.users.find(u => u.email?.toLowerCase() === oldEmail.toLowerCase())
    if (match) { authUserId = match.id; break }
    if (pageData.users.length < 200) break
  }

  if (authUserId) {
    const { error: authErr } = await admin.auth.admin.updateUserById(authUserId, {
      email: newEmail,
      email_confirm: true,
    })
    if (authErr) return json({ error: authErr.message }, 500)
  }

  const { error: dbErr } = await admin
    .from('users')
    .update({ email: newEmail })
    .eq('id', targetUserId)

  if (dbErr) {
    return json({
      error: authUserId
        ? `Auth email updated but the account record failed to save: ${dbErr.message}. This needs manual correction — contact support.`
        : dbErr.message,
    }, 500)
  }

  const notice = await sendEmailChangedNotice(admin, {
    userName: targetRow.name as string,
    oldEmail,
    newEmail,
  })

  return json({ success: true, noticeSent: notice.sent })
})
