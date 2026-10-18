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
