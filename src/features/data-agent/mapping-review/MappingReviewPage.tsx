import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useRealtime } from '@/hooks/useRealtime'
import type { DataAgentColumnMapping, DataAgentMigration } from '@/types/dataAgent'

interface TargetFieldOption { key: string; label: string; type: 'standard' | 'custom' }

const STATUS_STYLE: Record<DataAgentColumnMapping['status'], string> = {
  mapped: 'bg-green-100 text-green-700',
  uncertain: 'bg-amber-100 text-amber-700',
  unmapped: 'bg-red-100 text-red-700',
}

export function MappingReviewPage() {
  const { migrationId } = useParams<{ migrationId: string }>()
  const [migration, setMigration] = useState<DataAgentMigration | null>(null)
  const [mappings, setMappings] = useState<DataAgentColumnMapping[]>([])
  const [targetFields, setTargetFields] = useState<TargetFieldOption[]>([])
  const [pageError, setPageError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [defaultCountryCode, setDefaultCountryCode] = useState('')

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
        const row = (data as { fields: TargetFieldOption[] }[] | null)?.[0]
        setTargetFields(row?.fields ?? [])
      })
  }, [migration?.sub_account, migration?.target_object_type])

  useRealtime({ table: 'data_agent_column_mappings', filter: migrationId ? `migration_id=eq.${migrationId}` : undefined, onUpdate: () => void loadMappings() })

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

  const allResolved = mappings.length > 0 && mappings.every(m => m.status === 'mapped')

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-gray-900">{migration?.original_filename}</h1>
        <p className="text-sm text-gray-500">{migration?.row_count} rows → {migration?.target_object_type}</p>
      </div>

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
    </div>
  )
}
