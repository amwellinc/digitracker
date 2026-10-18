import { describe, it, expect } from 'vitest'
import { planColumnMappings, computeMigrationStatus, buildTargetFields } from '../dataAgentUploadPlanner'
import type { TargetField } from '../dataAgentMatching'

const FIELDS: TargetField[] = [
  { key: 'firstName', label: 'First Name', type: 'standard' },
  { key: 'email', label: 'Email', type: 'standard' },
  { key: 'phone', label: 'Phone', type: 'standard' },
  { key: 'custom_mobile_phone', label: 'Mobile Phone', type: 'custom' },
]

describe('planColumnMappings', () => {
  it('classifies every header and samples up to the first 10 rows', () => {
    const rows = Array.from({ length: 15 }, (_, i) => ({ Email: `user${i}@x.com`, Phone: '' }))
    const plan = planColumnMappings(['Email', 'Phone'], rows, null, FIELDS, [])
    expect(plan).toHaveLength(2)
    expect(plan.find(p => p.source_column_name === 'Email')?.sample_values).toHaveLength(10)
  })

  it('flags exactly one primary candidate among several green phone columns, without changing their status', () => {
    const rows = [{ Phone: '+14155550001', Mobile: '+14155550002' }]
    const plan = planColumnMappings(['Phone', 'Mobile'], rows, null, FIELDS, [])
    const phone = plan.find(p => p.source_column_name === 'Phone')!
    const mobile = plan.find(p => p.source_column_name === 'Mobile')!
    expect(mobile.metadata.is_primary_candidate).toBe(true)
    expect(phone.metadata.is_primary_candidate).toBeUndefined()
    expect(phone.status).toBe('mapped')
    expect(mobile.status).toBe('mapped')
  })

  it('does not flag a primary candidate when there is only one phone-like column', () => {
    const rows = [{ Phone: '+14155550001' }]
    const plan = planColumnMappings(['Phone'], rows, null, FIELDS, [])
    expect(plan[0].metadata.is_primary_candidate).toBeUndefined()
  })

  it('handles a column with no rows at all without throwing', () => {
    const plan = planColumnMappings(['Email'], [], null, FIELDS, [])
    expect(plan[0].sample_values).toEqual([])
    expect(plan[0].status).toBe('mapped')
  })

  it('does not mix an email-subtype column into the phone primary-candidate grouping', () => {
    const fieldsWithWorkEmail: TargetField[] = [...FIELDS, { key: 'custom_work_email', label: 'Work Email', type: 'custom' }]
    const rows = [{ Phone: '+14155550001', 'Work Email': 'jane@x.com' }]
    const plan = planColumnMappings(['Phone', 'Work Email'], rows, null, fieldsWithWorkEmail, [])
    const phone = plan.find(p => p.source_column_name === 'Phone')!
    const workEmail = plan.find(p => p.source_column_name === 'Work Email')!
    expect(workEmail.target_field_key).toBe('custom_work_email')
    expect(workEmail.metadata.is_primary_candidate).toBeUndefined()
    expect(phone.metadata.is_primary_candidate).toBeUndefined()
  })
})

describe('buildTargetFields', () => {
  it('bridges the real cached custom-field shape ({id, fieldKey, name}) into TargetField ({key, label, type}), using the GHL field id as the key', () => {
    const fields = buildTargetFields('contact', [{ id: 'abc123', fieldKey: 'mobile_phone', name: 'Mobile Phone' }])
    expect(fields).toContainEqual({ key: 'abc123', label: 'Mobile Phone', type: 'custom' })
  })

  it('includes the hardcoded standard contact fields for object type "contact"', () => {
    const fields = buildTargetFields('contact', [])
    expect(fields.map(f => f.key)).toContain('email')
    expect(fields.map(f => f.key)).toContain('phone')
    expect(fields.find(f => f.key === 'email')?.type).toBe('standard')
  })

  it('excludes standard contact fields for a Custom Object target (they do not apply)', () => {
    const fields = buildTargetFields('orders', [{ id: 'xyz789', fieldKey: 'order_number', name: 'Order Number' }])
    expect(fields).toEqual([{ key: 'xyz789', label: 'Order Number', type: 'custom' }])
  })
})

describe('computeMigrationStatus', () => {
  it('is awaiting_confirmation when every column is mapped, including one the user explicitly chose to ignore', () => {
    // A user-ignored column is status: 'mapped', target_type: 'ignored' (Task
    // 10) — "ignored" is itself a resolved decision, not a pending one.
    expect(computeMigrationStatus([{ status: 'mapped' }, { status: 'mapped' }])).toBe('awaiting_confirmation')
  })
  it('is mapping when any column is still uncertain or unmapped', () => {
    expect(computeMigrationStatus([{ status: 'mapped' }, { status: 'uncertain' }])).toBe('mapping')
  })
  it('is mapping for a genuinely unmapped column even though its target_type also happens to be "ignored" (the no-match sentinel, not a user decision)', () => {
    expect(computeMigrationStatus([{ status: 'unmapped' }])).toBe('mapping')
  })
})
