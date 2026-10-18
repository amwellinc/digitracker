import { describe, it, expect, vi } from 'vitest'
import { resolvePrompt } from '../dataAgentPrompt'

const FIELDS = [{ key: 'custom_notes', label: 'Notes', type: 'custom' as const }]
const context = { columnName: 'Misc', sampleValues: ['hi'], currentTargetFieldKey: null, currentStatus: 'unmapped' }

function mockResponse(body: unknown) {
  return vi.fn().mockResolvedValue(new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(body) }] }), { status: 200 }))
}

describe('resolvePrompt', () => {
  it('returns a clarifying reply with no action for a plain question', async () => {
    const fetchImpl = mockResponse({ responseText: 'This looks like a free-text note field.', action: null })
    const result = await resolvePrompt(context, FIELDS, 'what is this column?', 'key', fetchImpl)
    expect(result).toEqual({ responseText: 'This looks like a free-text note field.', action: null })
  })

  it('applies a clear remap instruction to a field that actually exists', async () => {
    const fetchImpl = mockResponse({ responseText: 'Mapped to Notes.', action: { target_field_key: 'custom_notes' } })
    const result = await resolvePrompt(context, FIELDS, 'map this to custom field Notes', 'key', fetchImpl)
    expect(result.action).toEqual({ target_field_key: 'custom_notes' })
  })

  it('applies an explicit ignore instruction', async () => {
    const fetchImpl = mockResponse({ responseText: 'Ignoring this column.', action: { ignore: true } })
    const result = await resolvePrompt(context, FIELDS, 'ignore this one', 'key', fetchImpl)
    expect(result.action).toEqual({ ignore: true })
  })

  it('discards a hallucinated field key that does not exist in the real schema, never inventing one', async () => {
    const fetchImpl = mockResponse({ responseText: 'Mapped to Phone Number.', action: { target_field_key: 'phone_number_that_does_not_exist' } })
    const result = await resolvePrompt(context, FIELDS, 'map this to the phone field', 'key', fetchImpl)
    expect(result.action).toBeNull()
    expect(result.responseText).toBe('Mapped to Phone Number.')
  })
})
