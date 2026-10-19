// Authorization: any Data Agent member of the given sub-account (checked
// via is_data_agent_member using the caller's own JWT — RLS does the real
// work). The PIT itself is read only here, server-side, from Vault, and
// never echoed back in the response.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { ensureSchemaCacheFresh } from '../_shared/dataAgentSchemaCache.ts'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } })
}

// IMPORTANT: every branch below returns HTTP 200. supabase-js's
// functions.invoke() throws a generic FunctionsHttpError — whose .message
// is ALWAYS the fixed string "Edge Function returned a non-2xx status
// code", never this function's own text — for any non-2xx response; the
// real body only reaches the caller via `error.context`, which none of
// this plan's UI callers read. Returning 200 with `{ ok, error }` for
// every business outcome is what actually lets `data.error` reach the UI
// as written (verified against the installed @supabase/functions-js
// source). Only true protocol-level cases (CORS preflight, wrong method)
// stay as real HTTP status codes, since the UI only ever sends POST and
// never has to parse those.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'Missing authorization header' })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } })
  const { data: { user: callerAuth }, error: callerErr } = await callerClient.auth.getUser()
  if (callerErr || !callerAuth?.email) return json({ error: 'Invalid session' })

  let body: { subAccount?: unknown }
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON body' }) }
  const subAccount = typeof body.subAccount === 'string' ? body.subAccount : ''
  if (!subAccount) return json({ error: 'subAccount is required' })

  const { data: isMember } = await callerClient.rpc('is_data_agent_member', { p_sub_account: subAccount })
  if (!isMember) return json({ ok: false, error: 'Not authorized for this sub-account' })

  const serviceClient = createClient(supabaseUrl, serviceKey)
  const { data: connection } = await serviceClient.from('data_agent_connections')
    .select('ghl_location_id').eq('sub_account', subAccount).maybeSingle()
  if (!connection) return json({ ok: false, error: 'No connection saved for this sub-account yet' })

  // Reads via a SECURITY DEFINER RPC, not PostgREST's vault schema route
  // (serviceClient.schema('vault')...) — that route only works if 'vault'
  // is explicitly exposed in the project's API settings, which it isn't
  // here by default, and silently returned no row instead of the real
  // token ("Saved token could not be read from Vault" regardless of what
  // the saved token actually was).
  const { data: pit, error: pitErr } = await serviceClient.rpc('get_data_agent_pit', { p_sub_account: subAccount })
  if (pitErr) {
    console.error('data-agent-test-connection: get_data_agent_pit RPC failed', pitErr)
    return json({ ok: false, error: 'Saved token could not be read — see server logs for details' })
  }
  if (!pit) return json({ ok: false, error: 'Saved token could not be read from Vault' })

  const config = { pit, locationId: (connection as { ghl_location_id: string }).ghl_location_id }

  try {
    await ensureSchemaCacheFresh(serviceClient, subAccount, config, { force: true })
    await serviceClient.from('data_agent_connections').update({ last_verified_at: new Date().toISOString() }).eq('sub_account', subAccount)
    return json({ ok: true })
  } catch (err) {
    // GHL's own response text (surfaced via assertOk() in dataAgentGhlClient.ts)
    // is logged in full server-side only, never forwarded to the browser —
    // an unverified third-party API echoing back any form of the submitted
    // token in an error body is a real secret-leak vector this function
    // must not relay to the client.
    console.error('data-agent-test-connection: GHL call failed', err)
    return json({ ok: false, error: 'Could not verify the connection — check the Location ID and token, then try again.' })
  }
})
