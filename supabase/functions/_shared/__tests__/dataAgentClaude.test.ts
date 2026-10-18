import { describe, it, expect, vi } from 'vitest'
import { proposeMappingsWithClaude } from '../dataAgentClaude'

describe('proposeMappingsWithClaude', () => {
  it('returns no proposals and makes no request for an empty column list', async () => {
    const fetchImpl = vi.fn()
    const result = await proposeMappingsWithClaude([], [], null, 'key', fetchImpl)
    expect(result).toEqual([])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('sends the API key and column context, and parses the JSON proposal array', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      content: [{ type: 'text', text: JSON.stringify([
        { source_column_name: 'Notes', target_field_key: 'custom_notes', confidence: 0.6, reasoning: 'Looks like free-text notes', metadata: {} },
      ]) }],
    }), { status: 200 }))

    const result = await proposeMappingsWithClaude(
      [{ columnName: 'Notes', sampleValues: ['hello'] }],
      [{ key: 'custom_notes', label: 'Notes', type: 'custom' }],
      null, 'test-key', fetchImpl,
    )

    expect(fetchImpl).toHaveBeenCalledWith('https://api.anthropic.com/v1/messages', expect.objectContaining({
      headers: expect.objectContaining({ 'x-api-key': 'test-key' }),
    }))
    expect(result).toEqual([{ source_column_name: 'Notes', target_field_key: 'custom_notes', confidence: 0.6, reasoning: 'Looks like free-text notes', metadata: {} }])
  })

  it('throws a clear error when the Anthropic API responds with a non-2xx status', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('rate limited', { status: 429 }))
    await expect(proposeMappingsWithClaude([{ columnName: 'X', sampleValues: [] }], [], null, 'key', fetchImpl))
      .rejects.toThrow(/429/)
  })

  it('allows a proposal with a null target_field_key (Claude declining to guess rather than inventing one)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      content: [{ type: 'text', text: JSON.stringify([
        { source_column_name: 'X', target_field_key: null, confidence: 0, reasoning: 'No plausible match', metadata: {} },
      ]) }],
    }), { status: 200 }))
    const result = await proposeMappingsWithClaude([{ columnName: 'X', sampleValues: [] }], [], null, 'key', fetchImpl)
    expect(result[0].target_field_key).toBeNull()
  })

  it('throws a clear error when the response text is not valid JSON', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      content: [{ type: 'text', text: 'not json at all' }],
    }), { status: 200 }))
    await expect(proposeMappingsWithClaude([{ columnName: 'X', sampleValues: [] }], [], null, 'key', fetchImpl))
      .rejects.toThrow(/not valid JSON/)
  })

  it('throws a clear error when the response has no text content block', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ content: [] }), { status: 200 }))
    await expect(proposeMappingsWithClaude([{ columnName: 'X', sampleValues: [] }], [], null, 'key', fetchImpl))
      .rejects.toThrow(/no text content/)
  })

  it('fills in a safe "no proposal" entry for any input column the model silently dropped, rather than returning a mismatched array', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      content: [{ type: 'text', text: JSON.stringify([
        { source_column_name: 'Notes', target_field_key: 'custom_notes', confidence: 0.9, reasoning: 'ok', metadata: {} },
      ]) }],
    }), { status: 200 }))
    const result = await proposeMappingsWithClaude(
      [{ columnName: 'Notes', sampleValues: [] }, { columnName: 'Dropped', sampleValues: [] }],
      [], null, 'key', fetchImpl,
    )
    expect(result).toHaveLength(2)
    expect(result.find(r => r.source_column_name === 'Dropped')).toEqual({
      source_column_name: 'Dropped', target_field_key: null, confidence: 0, reasoning: 'No proposal returned for this column', metadata: {},
    })
  })
})
