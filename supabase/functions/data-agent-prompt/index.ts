import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { resolvePrompt } from '../_shared/dataAgentPrompt.ts'
import { buildTargetFields, type CachedGhlField } from '../_shared/dataAgentUploadPlanner.ts'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } })
}

// Every business-outcome branch below returns HTTP 200 — see Task 5's
// data-agent-test-connection for why (supabase-js's functions.invoke()
// discards a non-2xx response's real body, always reporting a fixed
// generic message instead).
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'Missing authorization header' })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!anthropicKey) return json({ error: 'The prompt feature is not configured on this server' })

  const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } })
  const { data: { user: callerAuth }, error: callerErr } = await callerClient.auth.getUser()
  if (callerErr || !callerAuth?.email) return json({ error: 'Invalid session' })

  let body: { migrationId?: unknown; columnMappingId?: unknown; promptText?: unknown }
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON body' }) }
  const migrationId = typeof body.migrationId === 'string' ? body.migrationId : ''
  const columnMappingId = typeof body.columnMappingId === 'string' ? body.columnMappingId : ''
  const promptText = typeof body.promptText === 'string' ? body.promptText.trim() : ''
  if (!migrationId || !columnMappingId || !promptText) return json({ error: 'migrationId, columnMappingId, and promptText are required' })

  const serviceClient = createClient(supabaseUrl, serviceKey)
  const { data: migration } = await serviceClient.from('data_agent_migrations').select('sub_account, target_object_type, status').eq('id', migrationId).single()
  if (!migration) return json({ error: 'Migration not found' })
  const { data: isMember } = await callerClient.rpc('is_data_agent_member', { p_sub_account: (migration as { sub_account: string }).sub_account })
  if (!isMember) return json({ error: 'Not authorized for this migration' })
  // Mirrors the data_agent_column_mappings_update RLS policy's own
  // restriction (migration 20261018000100) — this service-role write
  // bypasses RLS entirely, so the same status gate has to be enforced
  // here explicitly, or a prompt submitted/replayed after the migration
  // moved past manual review could still silently apply a change.
  if (!['mapping', 'awaiting_confirmation'].includes((migration as { status: string }).status)) {
    return json({ error: 'This migration is no longer open for manual changes' })
  }

  // Scoped to migrationId, not just columnMappingId — without this, a
  // caller authorized for migrationId (Sub-Account A) could supply a
  // columnMappingId belonging to an unrelated migration (Sub-Account B)
  // and the service-role client below would read and overwrite B's row
  // with no ownership check at all. Matching on both columns means a
  // cross-tenant mismatch simply finds no row, falling into the existing
  // "Column mapping not found" branch.
  const { data: mapping } = await serviceClient.from('data_agent_column_mappings')
    .select('source_column_name, sample_values, target_field_key, status').eq('id', columnMappingId).eq('migration_id', migrationId).single()
  if (!mapping) return json({ error: 'Column mapping not found' })

  const { data: schemaCache } = await serviceClient.from('data_agent_ghl_schema_cache').select('fields')
    .eq('sub_account', (migration as { sub_account: string }).sub_account)
    .eq('object_type', (migration as { target_object_type: string }).target_object_type).maybeSingle()
  const cachedFields = ((schemaCache as { fields: CachedGhlField[] } | null)?.fields ?? [])
  const targetFields = buildTargetFields((migration as { target_object_type: string }).target_object_type, cachedFields)

  const m = mapping as { source_column_name: string; sample_values: string[]; target_field_key: string | null; status: string }
  const { data: appUser } = await callerClient.from('users').select('id').eq('email', callerAuth.email).single()

  let result
  try {
    result = await resolvePrompt(
      { columnName: m.source_column_name, sampleValues: m.sample_values, currentTargetFieldKey: m.target_field_key, currentStatus: m.status },
      targetFields, promptText, anthropicKey,
    )
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) })
  }

  if (result.action) {
    const update = 'ignore' in result.action
      ? { status: 'mapped', target_type: 'ignored', target_field_key: null, mapped_by: 'user', confirmed_by_user: true }
      : (() => {
          const targetKey = (result.action as { target_field_key: string }).target_field_key
          const field = targetFields.find(f => f.key === targetKey)
          return { status: 'mapped', target_type: field?.type === 'standard' ? 'standard_field' : 'custom_field', target_field_key: targetKey, mapped_by: 'user', confirmed_by_user: true }
        })()
    await serviceClient.from('data_agent_column_mappings').update(update).eq('id', columnMappingId)
  }

  await serviceClient.from('data_agent_prompts').insert({
    migration_id: migrationId, column_mapping_id: columnMappingId, user_id: (appUser as { id: string } | null)?.id ?? null,
    prompt_text: promptText, response_text: result.responseText, action_taken: result.action,
  })

  return json({ responseText: result.responseText })
})
