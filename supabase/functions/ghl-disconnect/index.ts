// Disconnects the caller's own sub-account from GHL: deletes the stored
// tokens and clears the connection markers on sub_accounts. Runs
// server-side (service role) because deleting ghl_installations requires
// it — there is no client-facing write policy on that table by design, all
// writes go through edge functions so there's one auditable place tokens
// are created, refreshed, or removed. Same auth pattern as the other
// admin-* / ghl-* edge functions: verify the caller's session, then check
// their role/sub_account before doing anything.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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
    .select('role, sub_account')
    .ilike('email', callerAuthUser.email)
    .maybeSingle()

  if (!callerRow || !['Admin', 'Super-Admin'].includes(callerRow.role as string)) {
    return json({ error: 'Only Admins can manage the GHL connection.' }, 403)
  }

  const { error: delErr } = await admin
    .from('ghl_installations')
    .delete()
    .eq('sub_account', callerRow.sub_account)
  if (delErr) return json({ error: delErr.message }, 500)

  await admin
    .from('sub_accounts')
    .update({ ghl_location_id: null, ghl_connected_at: null })
    .eq('code', callerRow.sub_account)

  return json({ success: true })
})
