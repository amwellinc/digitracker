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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'Missing authorization header' }, 401)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } })
  const { data: { user: callerAuth }, error: callerErr } = await callerClient.auth.getUser()
  if (callerErr || !callerAuth?.email) return json({ error: 'Invalid session' }, 401)

  let body: { subAccount?: unknown }
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON body' }, 400) }
  const subAccount = typeof body.subAccount === 'string' ? body.subAccount : ''
  if (!subAccount) return json({ error: 'subAccount is required' }, 400)

  const { data: isMember } = await callerClient.rpc('is_data_agent_member', { p_sub_account: subAccount })
  if (!isMember) return json({ ok: false, error: 'Not authorized for this sub-account' }, 403)

  const serviceClient = createClient(supabaseUrl, serviceKey)
  const { data: connection } = await serviceClient.from('data_agent_connections')
    .select('ghl_location_id, secret_name').eq('sub_account', subAccount).maybeSingle()
  if (!connection) return json({ ok: false, error: 'No connection saved for this sub-account yet' }, 400)

  const { data: secretRow } = await serviceClient
    .schema('vault').from('decrypted_secrets').select('decrypted_secret')
    .eq('name', (connection as { secret_name: string }).secret_name).maybeSingle()
  const pit = (secretRow as { decrypted_secret?: string } | null)?.decrypted_secret
  if (!pit) return json({ ok: false, error: 'Saved token could not be read from Vault' }, 500)

  const config = { pit, locationId: (connection as { ghl_location_id: string }).ghl_location_id }

  try {
    await ensureSchemaCacheFresh(serviceClient, subAccount, config, { force: true })
    await serviceClient.from('data_agent_connections').update({ last_verified_at: new Date().toISOString() }).eq('sub_account', subAccount)
    return json({ ok: true })
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) })
  }
})
