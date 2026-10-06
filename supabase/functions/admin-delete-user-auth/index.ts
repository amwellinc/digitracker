// Deletes a user's underlying Supabase Auth account. archive_and_delete_user
// (the RPC the client calls right after this) only ever removed the
// public.users row -- it has no way to reach Supabase Auth itself, which
// requires the service-role key. Left alone, that stranded Auth account
// permanently reserves the deleted person's email: any later attempt to
// reuse that address, either by changing an unrelated user's email to it
// (admin-change-email) or by signing up/being invited fresh, collides with
// an Auth record nothing in this app can see or sign in as anymore.
//
// Called from UsersTab's delete flow immediately before archive_and_delete_user,
// while the public.users row this function authorizes against still exists.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'Missing authorization header' }, 401)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey     = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } })
  const { data: { user: callerAuth }, error: callerErr } = await callerClient.auth.getUser()
  if (callerErr || !callerAuth?.email) return json({ error: 'Invalid session' }, 401)

  let body: { targetUserId?: unknown }
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON body' }, 400) }
  const targetUserId = typeof body.targetUserId === 'string' ? body.targetUserId : ''
  if (!targetUserId) return json({ error: 'targetUserId is required' }, 400)

  const admin = createClient(supabaseUrl, serviceKey)

  const { data: caller } = await admin.from('users').select('role, sub_account')
    .ilike('email', callerAuth.email).maybeSingle()
  if (!caller || !['Admin', 'Super-Admin'].includes(caller.role as string)) {
    return json({ error: 'Only Admins can delete users' }, 403)
  }

  const { data: target } = await admin.from('users').select('email, sub_account, status')
    .eq('id', targetUserId).maybeSingle()
  if (!target) return json({ error: 'User not found' }, 404)
  if (caller.role !== 'Super-Admin' && target.sub_account !== caller.sub_account) {
    return json({ error: 'You can only manage users in your own workspace' }, 403)
  }
  if (target.status !== 'suspended') {
    return json({ error: 'Only a suspended account can be deleted' }, 400)
  }

  const targetEmail = (target.email as string).toLowerCase()
  let authUserId: string | null = null
  for (let page = 1; ; page++) {
    const { data: pageData, error: listErr } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (listErr) return json({ error: listErr.message }, 500)
    const match = pageData.users.find(u => u.email?.toLowerCase() === targetEmail)
    if (match) { authUserId = match.id; break }
    if (pageData.users.length < 200) break
  }

  // No Auth account exists (e.g. never signed in) -- nothing to clean up.
  if (!authUserId) return json({ success: true })

  const { error: deleteErr } = await admin.auth.admin.deleteUser(authUserId)
  if (deleteErr) return json({ error: deleteErr.message }, 500)

  return json({ success: true })
})
