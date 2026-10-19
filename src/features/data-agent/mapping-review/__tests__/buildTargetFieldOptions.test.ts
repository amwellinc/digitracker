import { describe, it, expect } from 'vitest'
import { buildTargetFieldOptions } from '../buildTargetFieldOptions'

describe('buildTargetFieldOptions', () => {
  it('includes the standard contact fields plus the real cached custom fields, bridged to {key,label,type}', () => {
    const result = buildTargetFieldOptions('contact', [{ id: 'abc123', fieldKey: 'custom_notes', name: 'Notes', dataType: 'TEXT' }])
    expect(result).toContainEqual({ key: 'email', label: 'Email', type: 'standard' })
    expect(result).toContainEqual({ key: 'abc123', label: 'Notes', type: 'custom' })
  })

  it('never offers standard contact fields for a non-contact object type', () => {
    const result = buildTargetFieldOptions('pet', [{ id: 'xyz789', fieldKey: 'breed', name: 'Breed', dataType: 'TEXT' }])
    expect(result).toEqual([{ key: 'xyz789', label: 'Breed', type: 'custom' }])
  })
})
