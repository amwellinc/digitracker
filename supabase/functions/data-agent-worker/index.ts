import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  upsertContact, searchContactByEmail, searchObjectRecord, createObjectRecord, updateObjectRecord,
  type GhlClientConfig,
} from '../_shared/dataAgentGhlClient.ts'
import { buildGhlFields, getFieldValue, writeRecordBatch, type ConfirmedMapping, type GhlRecordWriter, type BatchRow } from '../_shared/dataAgentWriter.ts'

const BATCH_SIZE = 25

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

  const { data: migrating } = await serviceClient.from('data_agent_migrations').select('*').eq('status', 'migrating').limit(5)
  for (const migration of (migrating ?? []) as MigratingRow[]) {
    await processMigratingMigration(serviceClient, migration)
  }

  return json({ ok: true, processed: (migrating ?? []).length })
})

interface MigratingRow { id: string; sub_account: string; target_object_type: string; match_key_column: string | null; default_country_code: string | null }

async function loadGhlConfig(serviceClient: SupabaseClient, subAccount: string): Promise<GhlClientConfig | null> {
  const { data: connection } = await serviceClient.from('data_agent_connections').select('ghl_location_id, secret_name').eq('sub_account', subAccount).maybeSingle()
  if (!connection) return null
  const { data: secretRow } = await serviceClient.schema('vault').from('decrypted_secrets').select('decrypted_secret')
    .eq('name', (connection as { secret_name: string }).secret_name).maybeSingle()
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
    await serviceClient.from('data_agent_migrations').update({ status: 'failed', error_message: 'No usable GHL connection' }).eq('id', migration.id)
    return
  }

  const { data: mappingRows } = await serviceClient.from('data_agent_column_mappings')
    .select('source_column_name, target_type, target_field_key, metadata').eq('migration_id', migration.id)
  const mappings = (mappingRows ?? []) as ConfirmedMapping[]

  const { data: pendingRows } = await serviceClient.from('data_agent_migration_records')
    .select('id, source_row_data').eq('migration_id', migration.id).eq('write_status', 'pending').order('row_number').limit(BATCH_SIZE)
  const pending = (pendingRows ?? []) as { id: string; source_row_data: Record<string, string> }[]

  if (pending.length === 0) {
    const { count } = await serviceClient.from('data_agent_migration_records').select('id', { count: 'exact', head: true })
      .eq('migration_id', migration.id).eq('write_status', 'pending')
    if ((count ?? 0) === 0) await serviceClient.from('data_agent_migrations').update({ status: 'verifying' }).eq('id', migration.id)
    return
  }

  const isContact = migration.target_object_type === 'contact'
  const writer = buildWriter(isContact, config, migration.target_object_type, migration.match_key_column)

  const rows: BatchRow[] = pending.map(r => {
    const built = buildGhlFields(r.source_row_data, mappings, migration.default_country_code)
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
    if (result.writeStatus === 'pending') continue // 429 — untouched, retried next tick
    await serviceClient.from('data_agent_migration_records').update({
      write_status: result.writeStatus, ghl_record_id: result.ghlRecordId,
      pre_replace_snapshot: result.preReplaceSnapshot, error_message: result.errorMessage,
      written_at: result.writeStatus === 'failed' ? null : new Date().toISOString(),
    }).eq('id', result.recordId)
  }
}
