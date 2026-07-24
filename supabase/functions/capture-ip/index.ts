// Captures the caller's current IP address (from the x-forwarded-for header
// set by Supabase's edge network) and stores it on their own users row as
// "Remote Address". Runs server-side because req.headers is only available
// here — this also avoids leaking the user's IP to a third-party IP-echo
// service, unlike a client-side approach.
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
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: { user: callerAuthUser }, error: callerErr } = await callerClient.auth.getUser()
  if (callerErr || !callerAuthUser?.email) return json({ error: 'Invalid session' }, 401)

  const forwardedFor = req.headers.get('x-forwarded-for')
  const ip = forwardedFor?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || null
  if (!ip) return json({ success: false, error: 'Could not determine IP address' })

  const admin = createClient(supabaseUrl, serviceKey)
  const { error: updateErr } = await admin
    .from('users')
    .update({ last_ip_address: ip, last_ip_captured_at: new Date().toISOString() })
    .ilike('email', callerAuthUser.email)

  if (updateErr) return json({ error: updateErr.message }, 500)
  return json({ success: true, ip })
})
