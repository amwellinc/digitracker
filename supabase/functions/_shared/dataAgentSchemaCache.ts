// Shared schema-cache refresher for Data Agent. Both the "Test Connection"
// action (Task 5, an explicit, always-refresh user request) and Task 8's
// upload flow (a staleness-gated, implicit refresh — analysis must never
// run against a schema snapshot older than 24h) need the same "pull the
// real schema and upsert the cache" logic. Factored out once here so
// neither task reimplements it.
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { fetchContactCustomFields, fetchCustomObjects, type GhlClientConfig } from './dataAgentGhlClient.ts'

const STALE_AFTER_MS = 24 * 60 * 60 * 1000

// Returns true if a refresh actually ran (so callers can report it), false
// if the existing cache was still fresh and force was not set.
export async function ensureSchemaCacheFresh(
  serviceClient: SupabaseClient,
  subAccount: string,
  config: GhlClientConfig,
  options: { force: boolean },
): Promise<boolean> {
  if (!options.force) {
    const { data: existing } = await serviceClient.from('data_agent_ghl_schema_cache')
      .select('fetched_at').eq('sub_account', subAccount).order('fetched_at', { ascending: false }).limit(1).maybeSingle()
    const fetchedAt = (existing as { fetched_at?: string } | null)?.fetched_at
    const isFresh = fetchedAt && Date.now() - new Date(fetchedAt).getTime() < STALE_AFTER_MS
    if (isFresh) return false
  }

  const [customFields, objects] = await Promise.all([fetchContactCustomFields(config), fetchCustomObjects(config)])
  await serviceClient.from('data_agent_ghl_schema_cache').upsert([
    { sub_account: subAccount, object_type: 'contact', fields: customFields, fetched_at: new Date().toISOString() },
    ...objects.map(o => ({ sub_account: subAccount, object_type: o.key, fields: o.fields, fetched_at: new Date().toISOString() })),
  ], { onConflict: 'sub_account,object_type' })
  return true
}
