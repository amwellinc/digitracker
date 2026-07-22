// Suspends or reactivates a user: flips public.users.status AND bans/unbans
// their underlying Supabase Auth account, so the two states never drift and
// a suspension is enforced at the Auth layer too, not just by our own RLS.
// Runs entirely server-side because banning an auth account requires the
// service-role key, which must never reach the browser.
//
// Deployed WITHOUT --no-verify-jwt: Supabase's gateway rejects any request
// that isn't a valid Supabase session JWT before this code ever runs. The
// role/ownership check below is a second, explicit layer on top of that.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

interface RequestBody {
  targetUserId: string
  suspended: boolean
}

// Supabase doesn't support a literal permanent ban — ~100 years is the
// established convention for "indefinitely" until explicitly reactivated.
const PERMANENT_BAN_DURATION = '876000h'

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
  const { targetUserId, suspended } = body
  if (!targetUserId || typeof targetUserId !== 'string') {
    return json({ error: 'targetUserId is required' }, 400)
  }
  if (typeof suspended !== 'boolean') {
    return json({ error: 'suspended must be a boolean' }, 400)
  }

  const admin = createClient(supabaseUrl, serviceKey)

  const { data: callerRow } = await admin
    .from('users')
    .select('role, sub_account')
    .ilike('email', callerAuthUser.email)
    .maybeSingle()

  if (!callerRow || !['Admin', 'Super-Admin'].includes(callerRow.role as string)) {
    return json({ error: 'Only Admins can suspend or reactivate users' }, 403)
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

  const { error: updateErr } = await admin
    .from('users')
    .update({ status: suspended ? 'suspended' : 'active' })
    .eq('id', targetUserId)

  if (updateErr) return json({ error: updateErr.message }, 500)

  // Find the underlying Supabase Auth account, if one exists — a user who
  // was never invited yet has none, and there's nothing to ban.
  let authUserId: string | null = null
  for (let page = 1; ; page++) {
    const { data: pageData, error: listErr } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (listErr) return json({ error: listErr.message }, 500)
    const match = pageData.users.find(u => u.email?.toLowerCase() === targetRow.email.toLowerCase())
    if (match) { authUserId = match.id; break }
    if (pageData.users.length < 200) break
  }

  if (authUserId) {
    const { error: banErr } = await admin.auth.admin.updateUserById(authUserId, {
      ban_duration: suspended ? PERMANENT_BAN_DURATION : 'none',
    })
    if (banErr) return json({ error: banErr.message }, 500)
  }

  return json({ success: true })
})
