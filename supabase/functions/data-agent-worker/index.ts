import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  upsertContact, searchContactByEmail, searchObjectRecord, createObjectRecord, updateObjectRecord,
  getContact, getObjectRecord, deleteContact, deleteObjectRecord, GhlRateLimitError,
  type GhlClientConfig,
} from '../_shared/dataAgentGhlClient.ts'
import { buildGhlFields, getFieldValue, isBlankBuiltFields, writeRecordBatch, type ConfirmedMapping, type GhlRecordWriter, type BatchRow } from '../_shared/dataAgentWriter.ts'
import { computeSampleSize, sampleOffsets, flattenGhlRecordFields, compareFields } from '../_shared/dataAgentQa.ts'

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

  const staleThreshold = new Date(Date.now() - STALE_CLAIM_MS).toISOString()
  const { data: verifyingCandidates, error: verifyingCandErr } = await serviceClient.from('data_agent_migrations')
    .select('id').eq('status', 'verifying').or(`claimed_at.is.null,claimed_at.lt.${staleThreshold}`).limit(5)
  if (verifyingCandErr) console.error('Data Agent worker: failed to list verifying migrations:', verifyingCandErr)
  const verifyingCandidateIds = (verifyingCandidates ?? []).map(m => (m as { id: string }).id)
  let verifyingProcessedCount = 0
  if (verifyingCandidateIds.length > 0) {
    const { data: verifying, error: verifyingClaimErr } = await serviceClient.from('data_agent_migrations')
      .update({ claimed_at: new Date().toISOString() })
      .in('id', verifyingCandidateIds).eq('status', 'verifying')
      .or(`claimed_at.is.null,claimed_at.lt.${staleThreshold}`)
      .select('*')
    if (verifyingClaimErr) console.error('Data Agent worker: failed to claim verifying migrations:', verifyingClaimErr)
    for (const migration of (verifying ?? []) as MigratingRow[]) {
      await processVerifyingMigration(serviceClient, migration)
    }
    verifyingProcessedCount = (verifying ?? []).length
  }

  // Claimed exactly like the verifying dispatch loop above — two
  // overlapping ticks must not both process the same undoing migration.
  // The GHL-side operations here (delete-by-id, update-by-id with the
  // same snapshot) are naturally idempotent on their own, so this isn't
  // about preventing a duplicate CRM record the way Task 15's claim is —
  // it's about the per-record/per-migration undo_status bookkeeping
  // itself, which has no such self-healing: two overlapping ticks racing
  // to write different results (success vs. a transient failure) for the
  // same record can leave it permanently stuck in a wrong terminal state,
  // since nothing ever revisits a 'done'/'failed' row (found in this
  // task's review). Reuses data_agent_migrations.claimed_at (added for
  // the verifying phase) — the two phases' claims never overlap in time
  // since a migration is never 'verifying' and 'undoing' at once.
  const { data: undoingCandidates, error: undoingCandErr } = await serviceClient.from('data_agent_migrations')
    .select('id').eq('status', 'undoing').or(`claimed_at.is.null,claimed_at.lt.${staleThreshold}`).limit(5)
  if (undoingCandErr) console.error('Data Agent worker: failed to list undoing migrations:', undoingCandErr)
  const undoingCandidateIds = (undoingCandidates ?? []).map(m => (m as { id: string }).id)
  let undoingProcessedCount = 0
  if (undoingCandidateIds.length > 0) {
    const { data: undoing, error: undoingClaimErr } = await serviceClient.from('data_agent_migrations')
      .update({ claimed_at: new Date().toISOString() })
      .in('id', undoingCandidateIds).eq('status', 'undoing')
      .or(`claimed_at.is.null,claimed_at.lt.${staleThreshold}`)
      .select('*')
    if (undoingClaimErr) console.error('Data Agent worker: failed to claim undoing migrations:', undoingClaimErr)
    for (const migration of (undoing ?? []) as MigratingRow[]) {
      await processUndoingMigration(serviceClient, migration)
    }
    undoingProcessedCount = (undoing ?? []).length
  }

  return json({ ok: true, processed: (migrating ?? []).length + verifyingProcessedCount + undoingProcessedCount })
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
        if (!result.new) {
          // GHL's own upsert dedupe matched an EXISTING contact that our
          // pre-flight search (findExisting) didn't find — e.g. it
          // matched on phone when we only checked email. Treating this
          // as a genuine creation would record write_status: 'created'
          // with no snapshot, so a later undo would DELETE a real
          // contact that existed before this migration touched it.
          // Failing this row loudly (captured by writeRecordBatch's own
          // try/catch as 'failed') is far safer than silently
          // mis-recording it.
          throw new Error(`GHL upsert matched an existing contact (id ${result.contact.id}) when none was expected — refusing to record this as a new creation, since no pre-replace snapshot was captured for it`)
        }
        return { id: result.contact.id }
      },
      async replace(_id, fields) {
        const result = await upsertContact(config, { locationId: config.locationId, ...fields } as never)
        if (result.contact.id !== _id) {
          // GHL's upsert matched a DIFFERENT contact than the one our
          // pre-flight search found and snapshotted — the snapshot
          // captured may not correspond to whatever record was actually
          // just overwritten, so undo could restore the wrong contact
          // entirely. Fail loudly rather than record a mismatched undo.
          throw new Error(`GHL upsert matched a different contact (id ${result.contact.id}) than the one expected to be replaced (id ${_id}) — refusing to proceed, since the captured snapshot may not correspond to the record actually overwritten`)
        }
      },
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
  const { data: mappingRows, error: mappingErr } = await serviceClient.from('data_agent_column_mappings')
    .select('source_column_name, target_type, target_field_key, metadata').eq('migration_id', migration.id)
  if (mappingErr) { console.error(`Data Agent worker: failed to load column mappings for verifying migration ${migration.id}:`, mappingErr); return }
  const mappings = (mappingRows ?? []) as ConfirmedMapping[]

  const { count: totalWritten, error: countErr } = await serviceClient.from('data_agent_migration_records')
    .select('id', { count: 'exact', head: true }).eq('migration_id', migration.id).in('write_status', ['created', 'replaced'])
  if (countErr) { console.error(`Data Agent worker: failed to count written records for migration ${migration.id}:`, countErr); return }

  const sampleSize = computeSampleSize(totalWritten ?? 0)
  // Sample by picking random OFFSETS into the true total (not by fetching
  // the whole population) — a plain, unbounded .select() here would be
  // silently capped at PostgREST's default page size for any migration
  // with more written rows than that cap, biasing the sample toward an
  // arbitrary (and, without an explicit order, undefined) subset instead
  // of being genuinely representative.
  const offsets = sampleOffsets(totalWritten ?? 0, sampleSize)
  const sample: { id: string; source_row_data: Record<string, string>; ghl_record_id: string }[] = []
  for (const offset of offsets) {
    const { data: rows, error: rowErr } = await serviceClient.from('data_agent_migration_records')
      .select('id, source_row_data, ghl_record_id').eq('migration_id', migration.id).in('write_status', ['created', 'replaced'])
      .order('row_number').range(offset, offset)
    if (rowErr) { console.error(`Data Agent worker: failed to fetch sample offset ${offset} for migration ${migration.id}:`, rowErr); continue }
    if (rows?.[0]) sample.push(rows[0] as { id: string; source_row_data: Record<string, string>; ghl_record_id: string })
  }

  let accuracyRating: number | null = null
  let verificationNote: string | null = null

  if (sample.length > 0) {
    const config = await loadGhlConfig(serviceClient, migration.sub_account)
    if (!config) {
      // The migration itself already succeeded (it only reaches this
      // phase after a clean migrating phase) — only the QA step couldn't
      // run, so this stays `completed`, not `failed`, but must be
      // distinguishable from "nothing to verify" (both would otherwise
      // collapse into the same accuracy_rating: null with zero signal).
      verificationNote = 'Verification skipped: no usable GHL connection'
      console.error(`Data Agent worker: ${verificationNote} (migration ${migration.id})`)
    } else {
      const matchPcts: number[] = []
      for (const record of sample) {
        try {
          const fetched = migration.target_object_type === 'contact'
            ? (await getContact(config, record.ghl_record_id)).contact
            : (await getObjectRecord(config, migration.target_object_type, record.ghl_record_id)).properties
          const flattened = flattenGhlRecordFields(fetched as Record<string, unknown>)
          const comparisons = compareFields(record.source_row_data, mappings, flattened)
          const matchPct = comparisons.length === 0 ? 100 : (comparisons.filter(c => c.match).length / comparisons.length) * 100
          matchPcts.push(matchPct)
          const { error: insertErr } = await serviceClient.from('data_agent_qa_samples').insert({
            migration_record_id: record.id, fetched_ghl_data: fetched, field_comparisons: comparisons, match_pct: matchPct,
          })
          if (insertErr) console.error(`Data Agent worker: failed to insert QA sample for record ${record.id}:`, insertErr)
        } catch {
          // A sample that fails to re-fetch is skipped from the average rather
          // than crashing the whole verification pass — it is informational,
          // never a reason to block `completed` (spec §8).
        }
      }
      accuracyRating = matchPcts.length > 0 ? matchPcts.reduce((a, b) => a + b, 0) / matchPcts.length : null
    }
  }

  const { error } = await serviceClient.from('data_agent_migrations').update({
    status: 'completed', completed_at: new Date().toISOString(),
    accuracy_rating: accuracyRating, error_message: verificationNote, claimed_at: null,
  }).eq('id', migration.id)
  if (error) console.error(`Data Agent worker: failed to mark migration ${migration.id} completed:`, error)
}

async function processUndoingMigration(serviceClient: SupabaseClient, migration: MigratingRow) {
  // Reload the connection fresh, exactly like every other write — if it
  // has since changed, undo uses whatever is current now (Review Focus #5).
  const config = await loadGhlConfig(serviceClient, migration.sub_account)
  if (!config) {
    const { error } = await serviceClient.from('data_agent_migrations').update({ status: 'failed', error_message: 'No usable GHL connection for undo', claimed_at: null }).eq('id', migration.id)
    if (error) console.error(`Data Agent worker: failed to mark migration ${migration.id} failed (no connection for undo):`, error)
    return
  }

  const staleThreshold = new Date(Date.now() - STALE_CLAIM_MS).toISOString()
  const { data: candidateRows, error: candidateErr } = await serviceClient.from('data_agent_migration_records')
    .select('id').eq('migration_id', migration.id).eq('undo_status', 'pending')
    // Undo must reverse rows in REVERSE order: if two rows in the original
    // migration both touched the same real contact (duplicate emails are
    // common in CRM exports — e.g. row 1 created contact X, row 2 later
    // replaced X with new values, snapshotting row 1's values), undoing in
    // forward (ascending) order would restore row 1's original values
    // first, then immediately overwrite them again with row 2's restore
    // step, leaving the contact in the WRONG final state. Reversing the
    // order (undo the most recent write first) unwinds the chain of
    // overwrites correctly, the same way a text editor's undo stack works.
    .or(`claimed_at.is.null,claimed_at.lt.${staleThreshold}`).order('row_number', { ascending: false }).limit(BATCH_SIZE)
  if (candidateErr) { console.error(`Data Agent worker: failed to list pending undo records for migration ${migration.id}:`, candidateErr); return }
  const candidateIds = (candidateRows ?? []).map(r => (r as { id: string }).id)

  if (candidateIds.length === 0) {
    const { count: pendingCount, error: pendingErr } = await serviceClient.from('data_agent_migration_records').select('id', { count: 'exact', head: true })
      .eq('migration_id', migration.id).eq('undo_status', 'pending')
    if (pendingErr) { console.error(`Data Agent worker: failed to check remaining undo count for migration ${migration.id}:`, pendingErr); return }
    if ((pendingCount ?? 0) === 0) {
      // Nothing is pending anymore, but that includes rows that ended up
      // 'failed' — reporting 'undone' when some rows were never actually
      // reversed would be a false "this is fully undone" signal, exactly
      // as misleading as reporting a migration 'completed' when some
      // rows failed to write in the first place.
      const { count: failedCount, error: failedErr } = await serviceClient.from('data_agent_migration_records').select('id', { count: 'exact', head: true })
        .eq('migration_id', migration.id).eq('undo_status', 'failed')
      if (failedErr) { console.error(`Data Agent worker: failed to check failed-undo count for migration ${migration.id}:`, failedErr); return }
      const { error } = await serviceClient.from('data_agent_migrations').update({
        status: (failedCount ?? 0) > 0 ? 'failed' : 'undone',
        error_message: (failedCount ?? 0) > 0 ? `${failedCount} record(s) could not be undone — see their individual error_message for details` : null,
        claimed_at: null,
      }).eq('id', migration.id)
      if (error) console.error(`Data Agent worker: failed to mark migration ${migration.id} undone:`, error)
    }
    return
  }

  // Same atomic claim-via-UPDATE pattern as the migrating phase's record
  // claim: the WHERE clause re-checks undo_status/claimed_at in the same
  // statement, so a row another tick already claimed between the SELECT
  // above and this UPDATE simply won't come back from .select() here.
  const { data: claimedRows, error: claimErr } = await serviceClient.from('data_agent_migration_records')
    .update({ claimed_at: new Date().toISOString() })
    .in('id', candidateIds).eq('undo_status', 'pending')
    .or(`claimed_at.is.null,claimed_at.lt.${staleThreshold}`)
    .select('id, write_status, ghl_record_id, pre_replace_snapshot')
  if (claimErr) { console.error(`Data Agent worker: failed to claim undo records for migration ${migration.id}:`, claimErr); return }
  const pending = (claimedRows ?? []) as { id: string; write_status: string; ghl_record_id: string; pre_replace_snapshot: Record<string, unknown> | null }[]
  if (pending.length === 0) return // everything was claimed by a concurrent tick between our select and update

  const isContact = migration.target_object_type === 'contact'
  for (const record of pending) {
    try {
      if (record.write_status === 'created') {
        if (isContact) await deleteContact(config, record.ghl_record_id)
        else await deleteObjectRecord(config, migration.target_object_type, record.ghl_record_id)
      } else if (record.write_status === 'replaced') {
        // A 'replaced' row with no captured snapshot can't actually be
        // reversed — this should never happen (writeRecordBatch always
        // captures one for a replace), but failing loudly here is the
        // safe default: silently marking undo_status: 'done' with
        // nothing actually reverted would be a false "this was undone"
        // signal on a destructive, irreversible operation.
        if (!record.pre_replace_snapshot) throw new Error('Cannot undo: no pre-replace snapshot was captured for this record')
        if (isContact) await upsertContact(config, { locationId: config.locationId, ...record.pre_replace_snapshot } as never)
        else await updateObjectRecord(config, migration.target_object_type, record.ghl_record_id, record.pre_replace_snapshot)
      }
      const { error } = await serviceClient.from('data_agent_migration_records').update({ undo_status: 'done', claimed_at: null }).eq('id', record.id)
      if (error) console.error(`Data Agent worker: failed to mark record ${record.id} undo done:`, error)
    } catch (err) {
      if (err instanceof GhlRateLimitError) {
        // Left pending — release the claim so the very next tick can
        // retry immediately rather than waiting out the stale window.
        const { error } = await serviceClient.from('data_agent_migration_records').update({ claimed_at: null }).eq('id', record.id)
        if (error) console.error(`Data Agent worker: failed to release claim on undo record ${record.id}:`, error)
        continue
      }
      const { error } = await serviceClient.from('data_agent_migration_records').update({ undo_status: 'failed', error_message: err instanceof Error ? err.message : String(err), claimed_at: null }).eq('id', record.id)
      if (error) console.error(`Data Agent worker: failed to mark record ${record.id} undo failed:`, error)
    }
  }
}
