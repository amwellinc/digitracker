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
  // GHL's /objects/ listing can include 'contact' itself alongside real
  // custom objects — upserting a second (sub_account, 'contact') row in
  // the same multi-row call (it's already written explicitly below, with
  // the real contact custom fields) makes Postgres reject the WHOLE
  // statement ("ON CONFLICT DO UPDATE command cannot affect row a second
  // time"). Filtering it out here avoids that conflict outright.
  const customObjects = objects.filter(o => o.key !== 'contact')
  const { error: upsertErr } = await serviceClient.from('data_agent_ghl_schema_cache').upsert([
    { sub_account: subAccount, object_type: 'contact', fields: customFields, fetched_at: new Date().toISOString() },
    ...customObjects.map(o => ({ sub_account: subAccount, object_type: o.key, fields: o.fields, fetched_at: new Date().toISOString() })),
  ], { onConflict: 'sub_account,object_type' })
  // Must throw, not just log — this ran because the caller needs a FRESH
  // cache (Test Connection's explicit force:true, or upload's staleness
  // gate). Silently swallowing a failed write here previously let
  // Test Connection report "verified — schema refreshed" with a stale or
  // missing cache underneath it, sending the user straight into upload's
  // "No schema cached" error with no indication why.
  if (upsertErr) throw new Error(`Could not save refreshed schema cache: ${upsertErr.message}`)
  return true
}
