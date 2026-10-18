// Shared QA-sampling helpers for the Data Agent worker's `verifying` phase
// (Task 16). Pure functions only — no GHL calls, no Supabase client — kept
// separate so they can be unit tested without network mocks.
import type { ConfirmedMapping } from './dataAgentWriter.ts'

export function computeSampleSize(total: number): number {
  if (total === 0) return 0
  return Math.min(50, total, Math.max(1, Math.round(total * 0.1)))
}

export function selectRandomSample<T>(items: T[], size: number, randomFn: () => number = Math.random): T[] {
  if (size <= 0) return []
  if (size >= items.length) return [...items]
  const pool = [...items]
  const result: T[] = []
  for (let i = 0; i < size; i++) {
    const idx = Math.floor(randomFn() * pool.length)
    result.push(pool.splice(idx, 1)[0])
  }
  return result
}

// Picks `size` distinct offsets in [0, total) without ever materializing
// a `total`-length array — selectRandomSample over Array.from({length:
// total}) scales O(total) in both memory and time (its own internal
// `[...items]` copy plus up to `size` O(pool.length) splices), which is
// fine for a small list but a real cost once `total` is the written-row
// count of a large migration (this tool's own mainline case, not an edge
// case). Rejection sampling into a Set is O(size) in the common case
// (size is capped at 50 by computeSampleSize, so collisions are rare).
export function sampleOffsets(total: number, size: number, randomFn: () => number = Math.random): number[] {
  if (size <= 0 || total <= 0) return []
  if (size >= total) return Array.from({ length: total }, (_, i) => i)
  const chosen = new Set<number>()
  while (chosen.size < size) chosen.add(Math.floor(randomFn() * total))
  return [...chosen]
}

export function flattenGhlRecordFields(raw: Record<string, unknown>): Record<string, unknown> {
  const { customFields, ...rest } = raw as { customFields?: { id: string; value: unknown }[] }
  const flat: Record<string, unknown> = { ...rest }
  for (const cf of customFields ?? []) flat[cf.id] = cf.value
  return flat
}

export interface FieldComparison { field: string; expected: unknown; actual: unknown; match: boolean }

export function compareFields(sourceRow: Record<string, string>, mappings: ConfirmedMapping[], flattenedActual: Record<string, unknown>): FieldComparison[] {
  const comparisons: FieldComparison[] = []
  for (const m of mappings) {
    if (m.target_type !== 'standard_field' && m.target_type !== 'custom_field') continue
    if (!m.target_field_key) continue
    const expected = (sourceRow[m.source_column_name] ?? '').trim()
    const actual = flattenedActual[m.target_field_key]
    const actualStr = typeof actual === 'string' ? actual.trim() : actual == null ? '' : String(actual)
    comparisons.push({ field: m.target_field_key, expected, actual, match: expected.toLowerCase() === actualStr.toLowerCase() })
  }
  return comparisons
}
