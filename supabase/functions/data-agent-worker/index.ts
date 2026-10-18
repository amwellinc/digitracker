import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  upsertContact, searchContactByEmail, searchObjectRecord, createObjectRecord, updateObjectRecord,
  getContact, getObjectRecord,
  type GhlClientConfig,
} from '../_shared/dataAgentGhlClient.ts'
import { buildGhlFields, getFieldValue, isBlankBuiltFields, writeRecordBatch, type ConfirmedMapping, type GhlRecordWriter, type BatchRow } from '../_shared/dataAgentWriter.ts'
import { computeSampleSize, selectRandomSample, flattenGhlRecordFields, compareFields } from '../_shared/dataAgentQa.ts'

const BATCH_SIZE = 25
// A worker tick that crashed or ran unusually long shouldn't permanently
// strand its claimed rows — after this long with no result written back,
// another tick is allowed to reclaim and retry them.
const STALE_CLAIM_MS = 2 * 60_000

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  const secret = req.headers.get('x-worker-secret')
  const expected = Deno.env.get('DATA_AGENT_WORKER_SECRET')
  if (!expected || secret !== expected) return json({ error: 'Unauthorized' }, 401)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const serviceClient = createClient(supabaseUrl, serviceKey)

  const { data: migrating, error: migratingErr } = await serviceClient.from('data_agent_migrations').select('*').eq('status', 'migrating').limit(5)
  if (migratingErr) {
    console.error('Data Agent worker: failed to load migrating migrations:', migratingErr)
    return json({ error: 'Failed to load migrations' }, 500)
  }
  for (const migration of (migrating ?? []) as MigratingRow[]) {
    await processMigratingMigration(serviceClient, migration)
  }

  const { data: verifying, error: verifyingErr } = await serviceClient.from('data_agent_migrations').select('*').eq('status', 'verifying').limit(5)
  if (verifyingErr) {
    console.error('Data Agent worker: failed to load verifying migrations:', verifyingErr)
    return json({ error: 'Failed to load migrations' }, 500)
  }
  for (const migration of (verifying ?? []) as MigratingRow[]) {
    await processVerifyingMigration(serviceClient, migration)
  }

  return json({ ok: true, processed: (migrating ?? []).length + (verifying ?? []).length })
})

interface MigratingRow { id: string; sub_account: string; target_object_type: string; match_key_column: string | null; default_country_code: string | null }

async function loadGhlConfig(serviceClient: SupabaseClient, subAccount: string): Promise<GhlClientConfig | null> {
  const { data: connection, error: connErr } = await serviceClient.from('data_agent_connections').select('ghl_location_id, secret_name').eq('sub_account', subAccount).maybeSingle()
  if (connErr) { console.error(`Data Agent worker: failed to load connection for ${subAccount}:`, connErr); return null }
  if (!connection) return null
  const { data: secretRow, error: secretErr } = await serviceClient.schema('vault').from('decrypted_secrets').select('decrypted_secret')
    .eq('name', (connection as { secret_name: string }).secret_name).maybeSingle()
  if (secretErr) { console.error(`Data Agent worker: failed to load Vault secret for ${subAccount}:`, secretErr); return null }
  const pit = (secretRow as { decrypted_secret?: string } | null)?.decrypted_secret
  if (!pit) return null
  return { pit, locationId: (connection as { ghl_location_id: string }).ghl_location_id }
}

function buildWriter(isContact: boolean, config: GhlClientConfig, objectKey: string, matchKeyColumn: string | null): GhlRecordWriter {
  if (isContact) {
    return {
      async findExisting(matchValue) {
        const found = await searchContactByEmail(config, matchValue)
        return found ? { id: found.id, currentFields: found.fields } : null
      },
      async create(fields) {
        const result = await upsertContact(config, { locationId: config.locationId, ...fields } as never)
        return { id: result.contact.id }
      },
      async replace(_id, fields) { await upsertContact(config, { locationId: config.locationId, ...fields } as never) },
    }
  }
  return {
    async findExisting(matchValue) {
      const rec = await searchObjectRecord(config, objectKey, matchKeyColumn!, matchValue)
      return rec ? { id: rec.id, currentFields: rec.properties } : null
    },
    async create(fields) { return await createObjectRecord(config, objectKey, fields) },
    async replace(id, fields) { await updateObjectRecord(config, objectKey, id, fields) },
  }
}

async function processMigratingMigration(serviceClient: SupabaseClient, migration: MigratingRow) {
  const config = await loadGhlConfig(serviceClient, migration.sub_account)
  if (!config) {
    const { error } = await serviceClient.from('data_agent_migrations').update({ status: 'failed', error_message: 'No usable GHL connection' }).eq('id', migration.id)
    if (error) console.error(`Data Agent worker: failed to mark migration ${migration.id} as failed:`, error)
    return
  }

  const { data: mappingRows, error: mappingErr } = await serviceClient.from('data_agent_column_mappings')
    .select('source_column_name, target_type, target_field_key, metadata').eq('migration_id', migration.id)
  if (mappingErr) { console.error(`Data Agent worker: failed to load column mappings for migration ${migration.id}:`, mappingErr); return }
  const mappings = (mappingRows ?? []) as ConfirmedMapping[]

  const staleThreshold = new Date(Date.now() - STALE_CLAIM_MS).toISOString()
  const { data: candidateRows, error: candidateErr } = await serviceClient.from('data_agent_migration_records')
    .select('id').eq('migration_id', migration.id).eq('write_status', 'pending')
    .or(`claimed_at.is.null,claimed_at.lt.${staleThreshold}`)
    .order('row_number').limit(BATCH_SIZE)
  if (candidateErr) { console.error(`Data Agent worker: failed to list pending records for migration ${migration.id}:`, candidateErr); return }
  const candidateIds = (candidateRows ?? []).map(r => (r as { id: string }).id)

  if (candidateIds.length === 0) {
    // Checking `error` here matters: `count ?? 0` would otherwise treat a
    // failed count query the same as "genuinely zero pending rows left"
    // and wrongly transition this migration to 'verifying' — stranding
    // any rows that are still legitimately pending, since the worker
    // only ever polls migrations with status = 'migrating'.
    const { count, error: countErr } = await serviceClient.from('data_agent_migration_records').select('id', { count: 'exact', head: true })
      .eq('migration_id', migration.id).eq('write_status', 'pending')
    if (countErr) { console.error(`Data Agent worker: failed to check remaining pending count for migration ${migration.id}:`, countErr); return }
    if ((count ?? 0) === 0) {
      const { error } = await serviceClient.from('data_agent_migrations').update({ status: 'verifying' }).eq('id', migration.id)
      if (error) console.error(`Data Agent worker: failed to transition migration ${migration.id} to verifying:`, error)
    }
    return
  }

  // Atomic claim: the WHERE clause re-checks write_status/claimed_at in
  // the SAME statement, so a row another tick already claimed between
  // our SELECT above and this UPDATE simply won't match here and won't
  // come back from .select() — no double-processing, no extra locking
  // primitive needed.
  const { data: claimedRows, error: claimErr } = await serviceClient.from('data_agent_migration_records')
    .update({ claimed_at: new Date().toISOString() })
    .in('id', candidateIds).eq('write_status', 'pending')
    .or(`claimed_at.is.null,claimed_at.lt.${staleThreshold}`)
    .select('id, source_row_data')
  if (claimErr) { console.error(`Data Agent worker: failed to claim records for migration ${migration.id}:`, claimErr); return }
  const pending = (claimedRows ?? []) as { id: string; source_row_data: Record<string, string> }[]
  if (pending.length === 0) return // everything was claimed by a concurrent tick between our select and update

  const isContact = migration.target_object_type === 'contact'
  const writer = buildWriter(isContact, config, migration.target_object_type, migration.match_key_column)

  const builtRows = pending.map(r => ({ record: r, built: buildGhlFields(r.source_row_data, mappings, migration.default_country_code) }))

  // A row where every mapped column came back blank would otherwise still
  // be create()'d/replace()'d as an essentially-empty GHL record — mark
  // it skipped instead of writing it at all.
  const blankIds = builtRows.filter(b => isBlankBuiltFields(b.built)).map(b => b.record.id)
  if (blankIds.length > 0) {
    const { error } = await serviceClient.from('data_agent_migration_records')
      .update({ write_status: 'skipped', written_at: new Date().toISOString(), claimed_at: null }).in('id', blankIds)
    if (error) console.error(`Data Agent worker: failed to mark blank records skipped for migration ${migration.id}:`, error)
  }

  const rows: BatchRow[] = builtRows.filter(b => !isBlankBuiltFields(b.built)).map(({ record: r, built }) => {
    const fields = isContact
      ? { ...built.standardFields, customFields: built.customFields, tags: built.tags }
      : { ...built.standardFields, ...Object.fromEntries(built.customFields.map(c => [c.id, c.value])) }
    const matchValue = isContact
      ? (built.standardFields.email ?? built.standardFields.phone ?? null)
      : getFieldValue(r.source_row_data, mappings, migration.match_key_column ?? '')
    return { recordId: r.id, matchValue, fields }
  })

  const results = await writeRecordBatch(rows, writer)
  for (const result of results) {
    if (result.writeStatus === 'pending') {
      // 429 — release the claim so the very next tick can retry
      // immediately rather than waiting out the stale-claim window.
      const { error } = await serviceClient.from('data_agent_migration_records').update({ claimed_at: null }).eq('id', result.recordId)
      if (error) console.error(`Data Agent worker: failed to release claim on record ${result.recordId}:`, error)
      continue
    }
    const { error } = await serviceClient.from('data_agent_migration_records').update({
      write_status: result.writeStatus, ghl_record_id: result.ghlRecordId,
      pre_replace_snapshot: result.preReplaceSnapshot, error_message: result.errorMessage,
      written_at: result.writeStatus === 'failed' ? null : new Date().toISOString(),
      claimed_at: null,
    }).eq('id', result.recordId)
    if (error) {
      // This DB write failing right after a successful GHL write is a
      // genuine dual-write risk this plan accepts without a full outbox
      // pattern (out of scope for this task) — the row stays claimed
      // until the stale window expires, then gets retried and MAY create
      // a duplicate GHL record for a custom object (contacts self-heal
      // via GHL's upsert-by-email, per Task 5). Logging loudly here is
      // the mitigation: it turns a silent failure into an operationally
      // visible one instead of pretending this write-back can't fail.
      console.error(`Data Agent worker: CRITICAL — GHL write for record ${result.recordId} succeeded (${result.writeStatus}, ghl id ${result.ghlRecordId}) but writing that result back to the database failed — this row will be retried after the stale-claim window and may create a duplicate GHL record:`, error)
    }
  }
}

async function processVerifyingMigration(serviceClient: SupabaseClient, migration: MigratingRow) {
  const { data: mappingRows } = await serviceClient.from('data_agent_column_mappings')
    .select('source_column_name, target_type, target_field_key, metadata').eq('migration_id', migration.id)
  const mappings = (mappingRows ?? []) as ConfirmedMapping[]

  const { data: writtenRows } = await serviceClient.from('data_agent_migration_records')
    .select('id, source_row_data, ghl_record_id').eq('migration_id', migration.id).in('write_status', ['created', 'replaced'])
  const written = (writtenRows ?? []) as { id: string; source_row_data: Record<string, string>; ghl_record_id: string }[]

  const sampleSize = computeSampleSize(written.length)
  const sample = selectRandomSample(written, sampleSize)

  if (sample.length > 0) {
    const config = await loadGhlConfig(serviceClient, migration.sub_account)
    const matchPcts: number[] = []
    for (const record of sample) {
      if (!config) continue
      try {
        const fetched = migration.target_object_type === 'contact'
          ? (await getContact(config, record.ghl_record_id)).contact
          : (await getObjectRecord(config, migration.target_object_type, record.ghl_record_id)).properties
        const flattened = flattenGhlRecordFields(fetched as Record<string, unknown>)
        const comparisons = compareFields(record.source_row_data, mappings, flattened)
        const matchPct = comparisons.length === 0 ? 100 : (comparisons.filter(c => c.match).length / comparisons.length) * 100
        matchPcts.push(matchPct)
        await serviceClient.from('data_agent_qa_samples').insert({
          migration_record_id: record.id, fetched_ghl_data: fetched, field_comparisons: comparisons, match_pct: matchPct,
        })
      } catch {
        // A sample that fails to re-fetch is skipped from the average rather
        // than crashing the whole verification pass — it is informational,
        // never a reason to block `completed` (spec §8).
      }
    }
    const accuracyRating = matchPcts.length > 0 ? matchPcts.reduce((a, b) => a + b, 0) / matchPcts.length : null
    await serviceClient.from('data_agent_migrations').update({ status: 'completed', completed_at: new Date().toISOString(), accuracy_rating: accuracyRating }).eq('id', migration.id)
    return
  }

  await serviceClient.from('data_agent_migrations').update({ status: 'completed', completed_at: new Date().toISOString(), accuracy_rating: null }).eq('id', migration.id)
}
