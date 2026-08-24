// Refreshes the stored GHL access token for the caller's own sub-account
// using the stored refresh_token. Admin/Super-Admin only, matching the
// admin-set-* edge functions' auth pattern: verify the caller's session via
// the anon-key client, then look up their role/sub_account with the
// service-role client before doing anything privileged.
//
// No automatic/scheduled refresh exists yet — nothing in this codebase
// currently makes outbound authenticated calls to the GHL API using the
// stored token, so there's no live consumer that would silently break on
// an expired token today. This function exists so that a "Refresh
// Connection" action in the UI (and any future outbound GHL API call) has
// a single, safe, reusable way to get a fresh token before use, rather
// than each caller reimplementing the refresh-token grant.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const GHL_TOKEN_URL = 'https://services.leadconnectorhq.com/oauth/token'

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
  const clientId     = Deno.env.get('GHL_CLIENT_ID')
  const clientSecret = Deno.env.get('GHL_CLIENT_SECRET')

  if (!clientId || !clientSecret) {
    return json({ error: 'GHL OAuth is not configured.' }, 503)
  }

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

  const { data: installation } = await admin
    .from('ghl_installations')
    .select('refresh_token')
    .eq('sub_account', callerRow.sub_account)
    .maybeSingle()

  if (!installation) return json({ error: 'No GHL connection found for your workspace.' }, 404)

  let tokenData: { access_token: string; refresh_token: string; expires_in: number }
  try {
    const tokenRes = await fetch(GHL_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     clientId,
        client_secret: clientSecret,
        grant_type:    'refresh_token',
        refresh_token: installation.refresh_token,
        user_type:     'Location',
      }),
    })
    if (!tokenRes.ok) {
      const txt = await tokenRes.text()
      console.error('GHL token refresh failed:', tokenRes.status, txt)
      return json({ error: 'GoHighLevel rejected the refresh request. Reconnect the integration.' }, 502)
    }
    tokenData = await tokenRes.json()
  } catch (err) {
    console.error('Token refresh fetch error:', err)
    return json({ error: 'Network error contacting GoHighLevel.' }, 502)
  }

  const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString()

  const { error: updateErr } = await admin
    .from('ghl_installations')
    .update({
      access_token:  tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_at:    expiresAt,
      updated_at:    new Date().toISOString(),
    })
    .eq('sub_account', callerRow.sub_account)

  if (updateErr) return json({ error: updateErr.message }, 500)

  return json({ success: true, expiresAt })
})
