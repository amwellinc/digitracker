import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useRealtime } from '@/hooks/useRealtime'
import type { DataAgentColumnMapping, DataAgentMigration, DataAgentMigrationStatus, DataAgentWriteStatus } from '@/types/dataAgent'
import { buildTargetFieldOptions, type TargetFieldOption } from './buildTargetFieldOptions'

const STATUS_STYLE: Record<DataAgentColumnMapping['status'], string> = {
  mapped: 'bg-green-100 text-green-700',
  uncertain: 'bg-amber-100 text-amber-700',
  unmapped: 'bg-red-100 text-red-700',
}

const MIGRATION_STATUS_LABEL: Record<DataAgentMigrationStatus, string> = {
  uploaded: 'Uploaded', mapping: 'Mapping in progress', awaiting_confirmation: 'Awaiting your confirmation',
  migrating: 'Writing to GHL…', verifying: 'Verifying a sample of written records…',
  completed: 'Completed', completed_with_errors: 'Completed with errors', failed: 'Failed',
  cancelled: 'Cancelled', undoing: 'Undoing…', undone: 'Undone',
}
const MIGRATION_STATUS_BADGE: Record<DataAgentMigrationStatus, string> = {
  uploaded: 'bg-gray-100 text-gray-700', mapping: 'bg-gray-100 text-gray-700',
  awaiting_confirmation: 'bg-amber-100 text-amber-700', migrating: 'bg-blue-100 text-blue-700',
  verifying: 'bg-blue-100 text-blue-700', completed: 'bg-green-100 text-green-700',
  completed_with_errors: 'bg-amber-100 text-amber-700', failed: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-700', undoing: 'bg-blue-100 text-blue-700', undone: 'bg-gray-100 text-gray-700',
}
// Past this point, a remap click or Confirm click is either a silent
// no-op (no client UPDATE policy matches a migration that's already
// moved on, so RLS returns 0 rows affected with no error) or meaningless
// (the migration already started) — found as a live gap: the mapping
// table and Confirm button stayed fully interactive after a migration
// had already started migrating/completed.
const EDITABLE_STATUSES = new Set<DataAgentMigrationStatus>(['uploaded', 'mapping', 'awaiting_confirmation'])

interface RecordCounts { created: number; replaced: number; failed: number; skipped: number; pending: number }
interface FailedRecordRow { row_number: number; error_message: string | null }

export function MappingReviewPage() {
  const { migrationId } = useParams<{ migrationId: string }>()
  const [migration, setMigration] = useState<DataAgentMigration | null>(null)
  const [mappings, setMappings] = useState<DataAgentColumnMapping[]>([])
  const [targetFields, setTargetFields] = useState<TargetFieldOption[]>([])
  const [pageError, setPageError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [defaultCountryCode, setDefaultCountryCode] = useState('')
  const [promptText, setPromptText] = useState<Record<string, string>>({})
  const [promptReply, setPromptReply] = useState<Record<string, string>>({})
  const [promptBusy, setPromptBusy] = useState<string | null>(null)
  const [recordCounts, setRecordCounts] = useState<RecordCounts | null>(null)
  const [failedRecords, setFailedRecords] = useState<FailedRecordRow[]>([])

  const loadMappings = useCallback(async () => {
    if (!migrationId) return
    const { data } = await supabase.from('data_agent_column_mappings').select('*').eq('migration_id', migrationId).order('source_column_name')
    setMappings((data ?? []) as DataAgentColumnMapping[])
  }, [migrationId])

  useEffect(() => {
    if (!migrationId) return
    void supabase.from('data_agent_migrations').select('*').eq('id', migrationId).single()
      .then(({ data }) => setMigration(data as DataAgentMigration))
    void loadMappings()
  }, [migrationId, loadMappings])

  useEffect(() => {
    if (!migration?.sub_account || !migration?.target_object_type) return
    void supabase.from('data_agent_ghl_schema_cache').select('fields')
      .eq('sub_account', migration.sub_account).eq('object_type', migration.target_object_type)
      .then(({ data }) => {
        const row = (data as { fields: { id: string; fieldKey: string; name: string; dataType: string }[] }[] | null)?.[0]
        setTargetFields(buildTargetFieldOptions(migration.target_object_type, row?.fields ?? []))
      })
  }, [migration?.sub_account, migration?.target_object_type])

  const loadRecordStatus = useCallback(async () => {
    if (!migrationId) return
    const { data } = await supabase.from('data_agent_migration_records').select('write_status').eq('migration_id', migrationId)
    const rows = (data ?? []) as { write_status: DataAgentWriteStatus }[]
    const counts: RecordCounts = { created: 0, replaced: 0, failed: 0, skipped: 0, pending: 0 }
    for (const r of rows) {
      if (r.write_status === 'created' || r.write_status === 'replaced' || r.write_status === 'failed' || r.write_status === 'skipped' || r.write_status === 'pending') {
        counts[r.write_status]++
      }
    }
    setRecordCounts(counts)
    if (counts.failed > 0) {
      const { data: failedRows } = await supabase.from('data_agent_migration_records')
        .select('row_number, error_message').eq('migration_id', migrationId).eq('write_status', 'failed').order('row_number').limit(20)
      setFailedRecords((failedRows ?? []) as FailedRecordRow[])
    } else {
      setFailedRecords([])
    }
  }, [migrationId])

  useEffect(() => {
    // Nothing has been written yet while still in an editable status —
    // querying would only ever show all-zero counts.
    if (!migration || EDITABLE_STATUSES.has(migration.status)) return
    void loadRecordStatus()
  }, [migration?.status, loadRecordStatus])

  useRealtime({ table: 'data_agent_column_mappings', filter: migrationId ? `migration_id=eq.${migrationId}` : undefined, onUpdate: () => void loadMappings() })
  useRealtime({ table: 'data_agent_migrations', filter: migrationId ? `id=eq.${migrationId}` : undefined, onUpdate: row => setMigration(row as unknown as DataAgentMigration) })
  useRealtime({ table: 'data_agent_migration_records', filter: migrationId ? `migration_id=eq.${migrationId}` : undefined, onUpdate: () => void loadRecordStatus() })

  async function remap(mapping: DataAgentColumnMapping, choice: string) {
    const update = choice === 'ignore'
      ? { status: 'mapped' as const, target_type: 'ignored' as const, target_field_key: null, mapped_by: 'user' as const, confirmed_by_user: true }
      : (() => {
          const field = targetFields.find(f => f.key === choice)
          return {
            status: 'mapped' as const,
            target_type: (field?.type === 'standard' ? 'standard_field' : 'custom_field') as DataAgentColumnMapping['target_type'],
            target_field_key: choice, mapped_by: 'user' as const, confirmed_by_user: true,
          }
        })()
    const { error } = await supabase.from('data_agent_column_mappings').update(update).eq('id', mapping.id)
    if (error) { setPageError(`Could not update "${mapping.source_column_name}": ${error.message}`); return }
    await loadMappings()
  }

  async function askPrompt(mapping: DataAgentColumnMapping) {
    if (!migrationId || !promptText[mapping.id]?.trim()) return
    setPromptBusy(mapping.id)
    const { data, error } = await supabase.functions.invoke('data-agent-prompt', {
      body: { migrationId, columnMappingId: mapping.id, promptText: promptText[mapping.id].trim() },
    })
    setPromptBusy(null)
    // data-agent-prompt returns HTTP 200 for every business outcome (see
    // its own comment) so a real failure shows up as `data.error`, not a
    // thrown `error` — `error` only fires for a genuine network/relay
    // failure, which carries no useful message of its own either.
    if (error) { setPromptReply(prev => ({ ...prev, [mapping.id]: 'Error: could not reach the prompt service.' })); return }
    const result = data as { responseText?: string; error?: string }
    setPromptReply(prev => ({ ...prev, [mapping.id]: result.responseText ?? `Error: ${result.error ?? 'unknown failure'}` }))
    await loadMappings()
  }

  const needsCountryCode = mappings.some(m => m.status === 'mapped' && (m.metadata.country_code_presence === 'absent' || m.metadata.country_code_presence === 'mixed'))

  async function confirmMigration() {
    if (!migrationId) return
    setConfirming(true); setPageError(null)
    if (needsCountryCode && !defaultCountryCode.trim()) {
      setConfirming(false); setPageError('A default country code is required for at least one phone column.'); return
    }
    // There is no client UPDATE policy on data_agent_migrations (Task 7) —
    // the default country code is passed as an RPC parameter instead of a
    // separate prior write, which would silently no-op under RLS (0 rows
    // matched, no error) rather than actually persisting.
    const { error } = await supabase.rpc('confirm_data_agent_migration', {
      p_migration_id: migrationId, p_default_country_code: needsCountryCode ? defaultCountryCode.trim() : null,
    })
    setConfirming(false)
    if (error) setPageError(error.message)
  }

  const [undoing, setUndoing] = useState(false)
  const [undoError, setUndoError] = useState<string | null>(null)

  async function undoMigration() {
    if (!migrationId) return
    setUndoing(true); setUndoError(null)
    const { error } = await supabase.rpc('request_data_agent_undo', { p_migration_id: migrationId })
    setUndoing(false)
    if (error) setUndoError(error.message)
  }

  const allResolved = mappings.length > 0 && mappings.every(m => m.status === 'mapped')
  // Defaults to editable before the migration itself has loaded — the
  // mapping table (populated by a separate query) has always rendered
  // immediately regardless of migration-load timing, and must keep doing
  // so rather than flashing a blank "not editable" state for a moment.
  const isEditable = !migration || EDITABLE_STATUSES.has(migration.status)
  const canUndo = migration?.status === 'completed' || migration?.status === 'completed_with_errors'

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-gray-900">{migration?.original_filename}</h1>
        <p className="text-sm text-gray-500">{migration?.row_count} rows → {migration?.target_object_type}</p>
        {migration && (
          <span data-testid="migration-status" className={`inline-block mt-1 text-xs font-semibold px-2 py-1 rounded-full ${MIGRATION_STATUS_BADGE[migration.status]}`}>
            {MIGRATION_STATUS_LABEL[migration.status]}
          </span>
        )}
        {migration?.error_message && <p role="alert" className="text-sm text-red-600 mt-1">{migration.error_message}</p>}
      </div>

      {recordCounts && (recordCounts.created + recordCounts.replaced + recordCounts.failed + recordCounts.skipped + recordCounts.pending > 0) && (
        <div data-testid="record-counts" className="flex flex-wrap gap-4 text-sm text-gray-700">
          <span>Created: {recordCounts.created}</span>
          <span>Replaced: {recordCounts.replaced}</span>
          {recordCounts.skipped > 0 && <span className="text-gray-400">Skipped: {recordCounts.skipped}</span>}
          {recordCounts.pending > 0 && <span className="text-blue-600">Pending: {recordCounts.pending}</span>}
          {recordCounts.failed > 0 && <span className="text-red-600 font-semibold">Failed: {recordCounts.failed}</span>}
        </div>
      )}

      {failedRecords.length > 0 && (
        <div className="border border-red-200 rounded-lg p-3 space-y-1">
          <p className="text-xs font-semibold text-red-700">Failed rows (showing up to 20)</p>
          <ul className="text-xs text-red-600 space-y-0.5">
            {failedRecords.map(r => <li key={r.row_number}>Row {r.row_number}: {r.error_message}</li>)}
          </ul>
        </div>
      )}

      {isEditable && (
        <>
          <div className="divide-y divide-gray-100 border border-gray-200 rounded-lg">
            {mappings.map(m => (
              <div key={m.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">{m.source_column_name}</p>
                  {m.reasoning && <p className="text-xs text-gray-400">{m.reasoning}</p>}
                </div>
                <span data-testid={`status-${m.id}`} className={`text-xs font-semibold px-2 py-1 rounded-full ${STATUS_STYLE[m.status]}`}>
                  {m.status}
                </span>
                <select
                  aria-label={`Map "${m.source_column_name}" to`}
                  // target_type === 'ignored' alone does NOT mean the user chose to ignore
                  // this column — classifyColumn's no-match default (Task 6) also sets
                  // target_type: 'ignored' on a genuinely unmapped/red column, which still
                  // has status !== 'mapped'. Only a column BOTH mapped AND typed 'ignored'
                  // was actually ignored by a human.
                  value={m.target_field_key ?? (m.status === 'mapped' && m.target_type === 'ignored' ? 'ignore' : '')}
                  onChange={e => void remap(m, e.target.value)}
                  className="input text-xs"
                >
                  <option value="" disabled>Choose…</option>
                  {targetFields.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                  <option value="ignore">Ignore this column</option>
                </select>
                <div className="flex-1 min-w-[180px]">
                  <div className="flex gap-1">
                    <input
                      aria-label={`Ask about "${m.source_column_name}"`}
                      value={promptText[m.id] ?? ''}
                      onChange={e => setPromptText(prev => ({ ...prev, [m.id]: e.target.value }))}
                      placeholder="Ask or instruct…"
                      className="input text-xs flex-1"
                    />
                    <button onClick={() => void askPrompt(m)} disabled={promptBusy === m.id}
                      className="text-xs font-semibold text-violet-700 bg-violet-50 hover:bg-violet-100 disabled:opacity-50 rounded-md px-2">
                      Ask
                    </button>
                  </div>
                  {promptReply[m.id] && <p className="text-xs text-gray-500 mt-1">{promptReply[m.id]}</p>}
                </div>
              </div>
            ))}
          </div>

          {needsCountryCode && (
            <div>
              <label htmlFor="da-default-country-code" className="block text-xs font-medium text-gray-600 mb-1">
                Default country code (for phone numbers missing one)
              </label>
              <input id="da-default-country-code" value={defaultCountryCode} onChange={e => setDefaultCountryCode(e.target.value)}
                placeholder="+65" className="input w-28" />
            </div>
          )}

          {pageError && <p role="alert" className="text-sm text-red-600">{pageError}</p>}
          <button onClick={() => void confirmMigration()} disabled={!allResolved || confirming}
            className="text-sm font-semibold text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded-md px-4 py-2">
            {confirming ? 'Starting…' : 'Confirm & Migrate'}
          </button>
        </>
      )}

      {canUndo && (
        <div className="space-y-1">
          <button onClick={() => void undoMigration()} disabled={undoing}
            className="text-sm font-semibold text-red-600 bg-red-50 hover:bg-red-100 disabled:opacity-50 rounded-md px-4 py-2">
            {undoing ? 'Undoing…' : 'Undo Migration'}
          </button>
          {undoError && <p role="alert" className="text-sm text-red-600">{undoError}</p>}
        </div>
      )}
    </div>
  )
}
