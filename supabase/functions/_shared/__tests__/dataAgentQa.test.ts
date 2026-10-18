import { describe, it, expect } from 'vitest'
import { computeSampleSize, selectRandomSample, flattenGhlRecordFields, compareFields } from '../dataAgentQa'
import type { ConfirmedMapping } from '../dataAgentWriter'

describe('computeSampleSize', () => {
  it('is 0 for no written records', () => { expect(computeSampleSize(0)).toBe(0) })
  it('is at least 1 for a small total', () => { expect(computeSampleSize(10)).toBe(1) })
  it('is capped at 50 even for a very large total', () => { expect(computeSampleSize(10000)).toBe(50) })
  it('is roughly 10% for a mid-size total', () => { expect(computeSampleSize(300)).toBe(30) })
  it('never exceeds the total itself', () => { expect(computeSampleSize(3)).toBeLessThanOrEqual(3) })
})

describe('selectRandomSample', () => {
  it('returns exactly the requested size, as a subset of the input, with no duplicates', () => {
    const items = Array.from({ length: 20 }, (_, i) => i)
    const sample = selectRandomSample(items, 5, () => 0.5)
    expect(sample).toHaveLength(5)
    expect(new Set(sample).size).toBe(5)
    for (const v of sample) expect(items).toContain(v)
  })
  it('returns the whole list when size >= length', () => {
    expect(selectRandomSample([1, 2, 3], 5)).toHaveLength(3)
  })
  it('returns an empty array for size 0', () => {
    expect(selectRandomSample([1, 2, 3], 0)).toEqual([])
  })
})

describe('flattenGhlRecordFields', () => {
  it('spreads standard fields and maps customFields entries by id into one flat map', () => {
    const flat = flattenGhlRecordFields({ email: 'jane@x.com', customFields: [{ id: 'custom_notes', value: 'VIP' }] })
    expect(flat).toEqual({ email: 'jane@x.com', custom_notes: 'VIP' })
  })
  it('handles a record with no customFields array at all', () => {
    expect(flattenGhlRecordFields({ email: 'jane@x.com' })).toEqual({ email: 'jane@x.com' })
  })
})

describe('compareFields', () => {
  const mappings: ConfirmedMapping[] = [
    { source_column_name: 'Email', target_type: 'standard_field', target_field_key: 'email', metadata: {} },
    { source_column_name: 'Notes', target_type: 'custom_field', target_field_key: 'custom_notes', metadata: {} },
  ]

  it('matches equal values case-insensitively', () => {
    const result = compareFields({ Email: 'Jane@X.com', Notes: 'VIP' }, mappings, { email: 'jane@x.com', custom_notes: 'VIP' })
    expect(result.every(r => r.match)).toBe(true)
  })
  it('flags a mismatch', () => {
    const result = compareFields({ Email: 'jane@x.com', Notes: 'VIP' }, mappings, { email: 'jane@x.com', custom_notes: 'Regular' })
    expect(result.find(r => r.field === 'custom_notes')?.match).toBe(false)
  })
  it('flags a field missing from the fetched GHL record as a mismatch, not a crash', () => {
    const result = compareFields({ Email: 'jane@x.com', Notes: 'VIP' }, mappings, { email: 'jane@x.com' })
    expect(result.find(r => r.field === 'custom_notes')?.match).toBe(false)
  })
  it('returns an empty comparison list (vacuously 100%) when no field was actually mapped', () => {
    expect(compareFields({}, [], {})).toEqual([])
  })
})
