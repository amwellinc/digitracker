import { classifyColumn, pickPrimaryPhoneEmailColumn, detectPhoneEmailSubtype, type TargetField, type SourceProfileEntry, type ColumnClassification } from './dataAgentMatching.ts'

export interface PlannedColumnMapping extends ColumnClassification {
  source_column_name: string
  sample_values: string[]
  reasoning?: string // set by Task 12's Claude-tier pass; absent for a rules/profile match
}

// What's actually cached in data_agent_ghl_schema_cache.fields (Task 5's
// fetchContactCustomFields/fetchCustomObjects): GHL's raw custom-field
// shape, never GHL's standard fields (phone/email/name/etc. — GHL's
// customFields endpoint only ever returns custom fields, by definition).
export interface CachedGhlField { id: string; fieldKey: string; name: string }

// GHL's standard contact fields are never returned by any API call this
// app makes (there is no "list standard fields" endpoint — they're fixed,
// documented field names on the Contact object) — hardcoded here because
// that's the only way they can exist at all. Every key here must match
// what upsertContact()/the write pipeline (Task 15) actually sends.
const STANDARD_CONTACT_FIELDS: TargetField[] = [
  { key: 'firstName', label: 'First Name', type: 'standard' },
  { key: 'lastName', label: 'Last Name', type: 'standard' },
  { key: 'email', label: 'Email', type: 'standard' },
  { key: 'phone', label: 'Phone', type: 'standard' },
  { key: 'companyName', label: 'Company Name', type: 'standard' },
  { key: 'address1', label: 'Address', type: 'standard' },
  { key: 'city', label: 'City', type: 'standard' },
  { key: 'state', label: 'State', type: 'standard' },
  { key: 'postalCode', label: 'Postal Code', type: 'standard' },
  { key: 'country', label: 'Country', type: 'standard' },
  { key: 'website', label: 'Website', type: 'standard' },
]

// Bridges the real cached data into the shape classifyColumn/matchTargetSchema
// actually expects ({key, label, type}) — the cache's raw {id, fieldKey,
// name} objects are NOT interchangeable with TargetField (different
// property names entirely), and GHL's standard fields need to be supplied
// from the hardcoded list above since nothing ever caches them. A custom
// field's TargetField.key is its GHL field `id` specifically (not
// `fieldKey` or `name`) because that's what the write pipeline's
// customFields payload (Task 15) needs to send back to GHL.
export function buildTargetFields(objectType: string, cachedFields: CachedGhlField[]): TargetField[] {
  const customFields: TargetField[] = cachedFields.map(f => ({ key: f.id, label: f.name, type: 'custom' }))
  return objectType === 'contact' ? [...STANDARD_CONTACT_FIELDS, ...customFields] : customFields
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
    .filter(c => c.status === 'mapped' && (c.target_field_key === 'phone' || detectPhoneEmailSubtype(c.source_column_name)?.base === 'phone'))
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
