// Lets an Admin (or Super-Admin) set a login password for a user without
// requiring that user to click a magic-link email first. Runs entirely
// server-side because setting another user's password requires the Supabase
// service-role key, which must never reach the browser.
//
// Deployed WITHOUT --no-verify-jwt: Supabase's gateway rejects any request
// that isn't a valid Supabase session JWT before this code ever runs. The
// role/ownership check below is a second, explicit layer on top of that.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

interface RequestBody {
  targetUserId: string
  password: string
}

// supabase.functions.invoke() calls this cross-origin from the browser — without
// these headers (and explicit OPTIONS handling) the browser blocks every response
// before this code's own auth/authorization checks ever get a chance to run.
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
  const { targetUserId, password } = body
  if (!targetUserId || typeof targetUserId !== 'string') {
    return json({ error: 'targetUserId is required' }, 400)
  }
  if (!password || password.length < 8) {
    return json({ error: 'Password must be at least 8 characters' }, 400)
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
    return json({ error: 'Only Admins can set passwords for other users' }, 403)
  }

  const { data: targetRow } = await admin
    .from('users')
    .select('id, email, sub_account')
    .eq('id', targetUserId)
    .maybeSingle()

  if (!targetRow) return json({ error: 'User not found' }, 404)

  if (callerRow.role !== 'Super-Admin' && targetRow.sub_account !== callerRow.sub_account) {
    return json({ error: 'You can only manage users in your own workspace' }, 403)
  }

  // Find the underlying Supabase Auth account for this email, if one already
  // exists (e.g. from an earlier, never-confirmed magic-link attempt).
  let authUserId: string | null = null
  for (let page = 1; ; page++) {
    const { data: pageData, error: listErr } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (listErr) return json({ error: listErr.message }, 500)
    const match = pageData.users.find(u => u.email?.toLowerCase() === targetRow.email.toLowerCase())
    if (match) { authUserId = match.id; break }
    if (pageData.users.length < 200) break
  }

  const { error: writeErr } = authUserId
    ? await admin.auth.admin.updateUserById(authUserId, { password, email_confirm: true })
    : await admin.auth.admin.createUser({ email: targetRow.email, password, email_confirm: true })

  if (writeErr) return json({ error: writeErr.message }, 500)

  return json({ success: true })
})
