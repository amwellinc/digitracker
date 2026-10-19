import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { parseCsvWithHeaders } from '../_shared/parseCsv.ts'
import { planColumnMappings, computeMigrationStatus, buildTargetFields, type CachedGhlField } from '../_shared/dataAgentUploadPlanner.ts'
import type { SourceProfileEntry } from '../_shared/dataAgentMatching.ts'
import { ensureSchemaCacheFresh } from '../_shared/dataAgentSchemaCache.ts'
import { isValidDataAgentStoragePath } from '../_shared/dataAgentStoragePath.ts'
import { planWithClaude } from './planWithClaude.ts'

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
  if (!authHeader) return json({ error: 'Missing authorization header' })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } })
  const { data: { user: callerAuth }, error: callerErr } = await callerClient.auth.getUser()
  if (callerErr || !callerAuth?.email) return json({ error: 'Invalid session' })

  let body: { subAccount?: unknown; targetObjectType?: unknown; sourceSystem?: unknown; storagePath?: unknown; originalFilename?: unknown }
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON body' }) }
  const subAccount = typeof body.subAccount === 'string' ? body.subAccount : ''
  const targetObjectType = typeof body.targetObjectType === 'string' ? body.targetObjectType : ''
  const sourceSystem = body.sourceSystem === 'salesforce' || body.sourceSystem === 'hubspot' ? body.sourceSystem : null
  const storagePath = typeof body.storagePath === 'string' ? body.storagePath : ''
  const originalFilename = typeof body.originalFilename === 'string' ? body.originalFilename : ''
  if (!subAccount || !targetObjectType || !storagePath || !originalFilename) {
    return json({ error: 'subAccount, targetObjectType, storagePath, and originalFilename are required' })
  }
  if (!isValidDataAgentStoragePath(storagePath, subAccount)) {
    return json({ error: 'storagePath does not belong to the given subAccount' })
  }

  const { data: isMember } = await callerClient.rpc('is_data_agent_member', { p_sub_account: subAccount })
  if (!isMember) return json({ error: 'Not authorized for this sub-account' })

  const { data: appUser } = await callerClient.from('users').select('id').eq('email', callerAuth.email).single()
  const createdBy = (appUser as { id: string } | null)?.id ?? null

  const serviceClient = createClient(supabaseUrl, serviceKey)

  const { data: fileBlob, error: downloadErr } = await serviceClient.storage.from('data-agent-uploads').download(storagePath)
  if (downloadErr || !fileBlob) return json({ error: `Could not read uploaded file: ${downloadErr?.message ?? 'not found'}` })
  const csvText = await fileBlob.text()
  const { headers, rows } = parseCsvWithHeaders(csvText)
  if (headers.length === 0) return json({ error: 'The uploaded file has no columns' })

  // Analysis must never run against a schema snapshot older than 24h (spec
  // §4) — refresh it now if stale, before any classification happens, so
  // the user's review (Task 10) reflects the CRM's real current structure.
  const { data: connection } = await serviceClient.from('data_agent_connections')
    .select('ghl_location_id').eq('sub_account', subAccount).maybeSingle()
  if (!connection) return json({ error: 'No GHL connection configured for this sub-account yet' })
  // Reads via a SECURITY DEFINER RPC, not PostgREST's vault schema route
  // (serviceClient.schema('vault')...) — that route only works if 'vault'
  // is explicitly exposed in the project's API settings, which it isn't
  // here by default, and silently returned no row instead of the real
  // token.
  const { data: pit, error: pitErr } = await serviceClient.rpc('get_data_agent_pit', { p_sub_account: subAccount })
  if (pitErr) return json({ error: `Could not read the saved connection token: ${pitErr.message}` })
  if (!pit) return json({ error: 'Could not read the saved connection token' })
  const ghlConfig = { pit, locationId: (connection as { ghl_location_id: string }).ghl_location_id }

  try {
    await ensureSchemaCacheFresh(serviceClient, subAccount, ghlConfig, { force: false })
  } catch (err) {
    return json({ error: `Could not refresh the CRM schema before analysis: ${err instanceof Error ? err.message : String(err)}` })
  }

  const { data: schemaCache } = await serviceClient.from('data_agent_ghl_schema_cache')
    .select('fields').eq('sub_account', subAccount).eq('object_type', targetObjectType).maybeSingle()
  if (!schemaCache) return json({ error: `No schema cached for target object "${targetObjectType}" — run Test Connection in Settings first` })
  const cachedFields = ((schemaCache as { fields: CachedGhlField[] } | null)?.fields ?? [])
  const targetFields = buildTargetFields(targetObjectType, cachedFields)

  const { data: profileRows } = sourceSystem
    ? await serviceClient.from('data_agent_source_profiles').select('source_system, pattern, target_field_hint, subtype_hint').eq('source_system', sourceSystem)
    : { data: [] as SourceProfileEntry[] }
  const sourceProfiles = (profileRows ?? []) as SourceProfileEntry[]

  const rulesPlan = planColumnMappings(headers, rows, sourceSystem, targetFields, sourceProfiles)
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
  let plan = rulesPlan
  if (anthropicKey) {
    try {
      plan = await planWithClaude(rulesPlan, targetFields, sourceSystem, anthropicKey)
    } catch (err) {
      // A Claude failure (outage, malformed/truncated output, rate limit)
      // must not crash the whole upload and orphan the uploaded file —
      // falling back to the rules-only plan is safe by construction:
      // every column Claude would have tried to resolve simply stays
      // whatever the rules tier already decided (mapped, or red/unmapped
      // for a human to resolve), never silently treated as confirmed.
      console.error('Data Agent upload: Claude tier failed, falling back to rules-only plan:', err)
    }
  }
  const status = computeMigrationStatus(plan)

  const { data: migration, error: migrationErr } = await serviceClient.from('data_agent_migrations').insert({
    sub_account: subAccount, created_by: createdBy, target_object_type: targetObjectType,
    source_system: sourceSystem, original_filename: originalFilename, storage_path: storagePath,
    row_count: rows.length, status,
  }).select('id').single()
  if (migrationErr || !migration) return json({ error: `Could not create migration: ${migrationErr?.message}` })
  const migrationId = (migration as { id: string }).id

  const { error: mappingsErr } = await serviceClient.from('data_agent_column_mappings').insert(
    plan.map(p => ({
      migration_id: migrationId, source_column_name: p.source_column_name, sample_values: p.sample_values,
      target_type: p.target_type, target_field_key: p.target_field_key, status: p.status,
      confidence: p.confidence, mapped_by: p.mapped_by, metadata: p.metadata,
      reasoning: p.reasoning ?? null,
    }))
  )
  if (mappingsErr) {
    await serviceClient.from('data_agent_migrations').update({ status: 'failed', error_message: mappingsErr.message }).eq('id', migrationId)
    return json({ error: `Could not create column mappings: ${mappingsErr.message}` })
  }

  const { error: recordsErr } = await serviceClient.from('data_agent_migration_records').insert(
    rows.map((row, idx) => ({ migration_id: migrationId, row_number: idx + 1, source_row_data: row }))
  )
  if (recordsErr) {
    await serviceClient.from('data_agent_migrations').update({ status: 'failed', error_message: recordsErr.message }).eq('id', migrationId)
    return json({ error: `Could not store source rows: ${recordsErr.message}` })
  }

  return json({ migrationId })
})
