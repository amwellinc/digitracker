import { classifyColumn, pickPrimaryPhoneEmailColumn, type TargetField, type SourceProfileEntry, type ColumnClassification } from './dataAgentMatching.ts'

export interface PlannedColumnMapping extends ColumnClassification {
  source_column_name: string
  sample_values: string[]
  reasoning?: string // set by Task 12's Claude-tier pass; absent for a rules/profile match
}

const SAMPLE_ROWS = 10

export function planColumnMappings(
  headers: string[],
  rows: Record<string, string>[],
  sourceSystem: 'salesforce' | 'hubspot' | null,
  targetFields: TargetField[],
  sourceProfiles: SourceProfileEntry[],
): PlannedColumnMapping[] {
  const sampleCount = Math.min(rows.length, SAMPLE_ROWS)
  const classifications: PlannedColumnMapping[] = headers.map(columnName => {
    const sampleValues = rows.slice(0, sampleCount).map(r => r[columnName] ?? '')
    const classification = classifyColumn({ columnName, sampleValues, sourceSystem, targetFields, sourceProfiles })
    return { ...classification, source_column_name: columnName, sample_values: sampleValues }
  })

  // Flag which of several green phone-mapped columns is the primary
  // candidate — informational only (spec §6.1 step 4); never changes status.
  const phoneColumns = classifications
    .filter(c => c.status === 'mapped' && (c.target_field_key === 'phone' || c.metadata.subtype))
    .map(c => ({ columnName: c.source_column_name, subtype: c.metadata.subtype ?? null }))
  if (phoneColumns.length > 1) {
    const primary = pickPrimaryPhoneEmailColumn(phoneColumns)
    const winner = classifications.find(c => c.source_column_name === primary)
    if (winner) winner.metadata = { ...winner.metadata, is_primary_candidate: true }
  }

  return classifications
}

// Blocking is purely a function of status, never target_type — see the
// comment on confirm_data_agent_migration (Task 7) for why target_type
// alone can't distinguish "nothing to map to" from "user chose to skip
// this column": both use target_type 'ignored', but only the latter sets
// status to 'mapped'.
export function computeMigrationStatus(mappings: { status: ColumnClassification['status'] }[]): 'mapping' | 'awaiting_confirmation' {
  const blocking = mappings.some(m => m.status !== 'mapped')
  return blocking ? 'mapping' : 'awaiting_confirmation'
}
