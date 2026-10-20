// supabase/functions/_shared/dataAgentWriter.ts (part 1 of 2 — field building)
import { detectPhoneEmailSubtype } from './dataAgentMatching.ts'

export interface ConfirmedMapping {
  source_column_name: string
  target_type: 'standard_field' | 'custom_field' | 'tag' | 'ignored'
  target_field_key: string | null
  metadata: {
    country_code_presence?: 'present' | 'absent' | 'mixed'; subtype?: string; dnd_channel?: string
    // 'value' (the default for a user-chosen tag mapping): the cell
    // itself holds one or more tag names, comma-separated, as a real
    // "Tags" export column typically does — each piece becomes its own
    // GHL tag. 'fixed' (unset/undefined also means this, for backward
    // compatibility with every tag mapping the DND rule tier already
    // created before this distinction existed): the cell is a boolean-
    // ish indicator, and target_field_key is the ONE fixed tag text
    // applied whenever it's truthy — never the cell's own content.
    tag_source?: 'fixed' | 'value'
  }
}

export interface BuiltGhlFields {
  standardFields: Record<string, string>
  customFields: { id: string; value: string }[]
  tags: string[]
}

export function applyDefaultCountryCode(value: string, defaultCountryCode: string | null): string {
  // Check and strip against the TRIMMED value — a value with leading
  // whitespace (" 091234567") must still have its leading zero detected
  // and stripped; checking .startsWith('+') on the trimmed value but then
  // stripping zeros from the untrimmed original (the review-flagged bug)
  // silently produced a malformed "+65 091234567".
  const trimmed = value.trim()
  if (!trimmed || !defaultCountryCode || trimmed.startsWith('+')) return value
  return `${defaultCountryCode}${trimmed.replace(/^0+/, '')}`
}

// Common CSV boolean-export conventions for a DND/opt-out column whose
// mere presence would otherwise always apply the tag regardless of what
// the cell actually says — getting this backwards has real compliance
// consequences, so a recognizably-falsy value must not apply the tag.
const FALSY_TAG_VALUES = new Set(['no', 'false', '0', 'n', 'off'])

export function buildGhlFields(sourceRow: Record<string, string>, mappings: ConfirmedMapping[], defaultCountryCode: string | null): BuiltGhlFields {
  const standardFields: Record<string, string> = {}
  const customFields: { id: string; value: string }[] = []
  const tags: string[] = []

  for (const m of mappings) {
    if (m.target_type === 'ignored' || !m.target_field_key) continue
    const raw = sourceRow[m.source_column_name] ?? ''
    // Blank-check on the trimmed value (consistent with getFieldValue's
    // own check below) without permanently trimming raw — a whitespace-
    // only cell is blank, but a cell with meaningful leading/trailing
    // whitespace around real content keeps that content as written.
    if (raw.trim() === '') continue

    if (m.target_type === 'tag') {
      if (m.metadata.tag_source === 'value') {
        // The cell is itself a list of tag names, not an indicator —
        // e.g. "VIP, Newsletter, Spring2026" becomes three separate GHL
        // tags for this row, not one literal tag containing commas.
        for (const piece of raw.split(',').map(t => t.trim()).filter(t => t.length > 0)) tags.push(piece)
      } else if (!FALSY_TAG_VALUES.has(raw.trim().toLowerCase())) {
        tags.push(m.target_field_key)
      }
      continue
    }

    // Re-derives the real base (phone vs. email) from the source column
    // name directly, rather than trusting metadata.subtype's bare value —
    // a "Work Email" column and a "Work Phone" column both get
    // metadata.subtype === 'work' (the subtype keyword alone can't tell
    // the two apart), so checking subtype membership alone would wrongly
    // apply a phone country-code prefix to an email address. Same fix
    // already applied once in dataAgentUploadPlanner.ts's own primary-
    // candidate grouping for the identical reason.
    const isPhoneLike = m.target_field_key === 'phone' || detectPhoneEmailSubtype(m.source_column_name)?.base === 'phone'
    const value = isPhoneLike ? applyDefaultCountryCode(raw, defaultCountryCode) : raw

    if (m.target_type === 'standard_field') standardFields[m.target_field_key] = value
    else customFields.push({ id: m.target_field_key, value })
  }

  return { standardFields, customFields, tags }
}

export function getFieldValue(sourceRow: Record<string, string>, mappings: ConfirmedMapping[], targetFieldKey: string): string | null {
  const mapping = mappings.find(m => m.target_field_key === targetFieldKey)
  if (!mapping) return null
  const value = sourceRow[mapping.source_column_name]
  return value && value.trim().length > 0 ? value : null
}

// A row where every mapped column came back blank would otherwise still
// reach writer.create()/replace() as an essentially-empty GHL record —
// for a custom object (no upsert validation) this silently creates a
// junk record with no signal anything was wrong. The worker checks this
// before calling writeRecordBatch and marks such rows 'skipped' instead
// (a write_status the schema already allows for exactly this case).
export function isBlankBuiltFields(built: BuiltGhlFields): boolean {
  return Object.keys(built.standardFields).length === 0 && built.customFields.length === 0 && built.tags.length === 0
}

// supabase/functions/_shared/dataAgentWriter.ts (part 2 of 2 — batch writing)
import { GhlRateLimitError, GhlTransientError } from './dataAgentGhlClient.ts'

export interface GhlRecordWriter {
  findExisting(matchValue: string): Promise<{ id: string; currentFields: Record<string, unknown> } | null>
  create(fields: Record<string, unknown>): Promise<{ id: string }>
  replace(id: string, fields: Record<string, unknown>): Promise<void>
}

export interface BatchRow {
  recordId: string
  matchValue: string | null
  fields: Record<string, unknown>
}

export interface BatchWriteResult {
  recordId: string
  writeStatus: 'created' | 'replaced' | 'failed' | 'skipped' | 'pending'
  ghlRecordId: string | null
  preReplaceSnapshot: Record<string, unknown> | null
  errorMessage: string | null
}

// Sequential, not parallel — the duplicate-row case (Review Focus #3)
// depends on each row seeing the previous row's write already applied.
//
// onResult, when given, is awaited immediately after EACH row's result is
// computed — before moving on to the next row — so the caller can persist
// that single result right away instead of collecting all of them and
// writing back only once the whole batch finishes. Without this, a worker
// invocation that times out or gets killed partway through a batch loses
// every already-succeeded GHL write's result: those rows stay 'pending',
// get reclaimed by a later tick, and get written to GHL a second time
// (duplicate custom-object records; a contact row incorrectly recorded as
// 'replaced' with a pre-replace snapshot that's actually the migrated
// data, poisoning undo).
export async function writeRecordBatch(
  rows: BatchRow[],
  writer: GhlRecordWriter,
  onResult?: (result: BatchWriteResult) => void | Promise<void>,
): Promise<BatchWriteResult[]> {
  const results: BatchWriteResult[] = []
  for (const row of rows) {
    let result: BatchWriteResult
    try {
      const existing = row.matchValue ? await writer.findExisting(row.matchValue) : null
      if (existing) {
        await writer.replace(existing.id, row.fields)
        result = { recordId: row.recordId, writeStatus: 'replaced', ghlRecordId: existing.id, preReplaceSnapshot: existing.currentFields, errorMessage: null }
      } else {
        const created = await writer.create(row.fields)
        result = { recordId: row.recordId, writeStatus: 'created', ghlRecordId: created.id, preReplaceSnapshot: null, errorMessage: null }
      }
    } catch (err) {
      if (err instanceof GhlRateLimitError || err instanceof GhlTransientError) {
        // Left pending, not failed — retried on a later worker tick (spec §7.4).
        result = { recordId: row.recordId, writeStatus: 'pending', ghlRecordId: null, preReplaceSnapshot: null, errorMessage: err.message }
      } else {
        // A genuine error — isolated to this row; the loop continues regardless.
        result = { recordId: row.recordId, writeStatus: 'failed', ghlRecordId: null, preReplaceSnapshot: null, errorMessage: err instanceof Error ? err.message : String(err) }
      }
    }
    results.push(result)
    if (onResult) await onResult(result)
  }
  return results
}
