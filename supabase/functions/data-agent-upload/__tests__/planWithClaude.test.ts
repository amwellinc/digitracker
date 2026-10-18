import { describe, it, expect, vi } from 'vitest'
import { planWithClaude } from '../planWithClaude'
import type { PlannedColumnMapping } from '../../_shared/dataAgentUploadPlanner'

describe('planWithClaude', () => {
  it('leaves already-mapped columns untouched and does not call Claude for them', async () => {
    const rulesPlan: PlannedColumnMapping[] = [
      { status: 'mapped', mapped_by: 'rule', target_field_key: 'email', target_type: 'standard_field', confidence: 1, metadata: {}, source_column_name: 'Email', sample_values: ['a@x.com'] },
    ]
    const proposeFn = vi.fn()
    const result = await planWithClaude(rulesPlan, [], null, 'key', proposeFn)
    expect(proposeFn).not.toHaveBeenCalled()
    expect(result).toEqual(rulesPlan)
  })

  it('sends only the unmapped columns to Claude, and marks any proposal as uncertain regardless of confidence', async () => {
    const rulesPlan: PlannedColumnMapping[] = [
      { status: 'mapped', mapped_by: 'rule', target_field_key: 'email', target_type: 'standard_field', confidence: 1, metadata: {}, source_column_name: 'Email', sample_values: ['a@x.com'] },
      { status: 'unmapped', mapped_by: null, target_field_key: null, target_type: 'ignored', confidence: null, metadata: {}, source_column_name: 'Notes', sample_values: ['hi'] },
    ]
    const proposeFn = vi.fn().mockResolvedValue([
      { source_column_name: 'Notes', target_field_key: 'custom_notes', confidence: 0.95, reasoning: 'Free text', metadata: {} },
    ])
    const result = await planWithClaude(rulesPlan, [{ key: 'custom_notes', label: 'Notes', type: 'custom' }], null, 'key', proposeFn)

    expect(proposeFn).toHaveBeenCalledWith([{ columnName: 'Notes', sampleValues: ['hi'] }], expect.anything(), null, 'key', undefined)
    const notes = result.find(r => r.source_column_name === 'Notes')!
    expect(notes.status).toBe('uncertain')
    expect(notes.mapped_by).toBe('claude')
    expect(notes.target_field_key).toBe('custom_notes')
    expect(notes.confidence).toBe(0.95)
  })

  it('leaves a column unmapped (red) when Claude also declines with target_field_key null', async () => {
    const rulesPlan: PlannedColumnMapping[] = [
      { status: 'unmapped', mapped_by: null, target_field_key: null, target_type: 'ignored', confidence: null, metadata: {}, source_column_name: 'Weird', sample_values: [] },
    ]
    const proposeFn = vi.fn().mockResolvedValue([
      { source_column_name: 'Weird', target_field_key: null, confidence: 0, reasoning: 'No match', metadata: {} },
    ])
    const result = await planWithClaude(rulesPlan, [], null, 'key', proposeFn)
    expect(result[0].status).toBe('unmapped')
    expect(result[0].reasoning).toBe('No match')
  })
})
