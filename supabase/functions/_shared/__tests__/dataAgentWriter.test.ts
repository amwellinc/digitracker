// supabase/functions/_shared/__tests__/dataAgentWriter.test.ts (part 1 of 2 — field building)
import { describe, it, expect, vi } from 'vitest'
import { buildGhlFields, getFieldValue, applyDefaultCountryCode, isBlankBuiltFields, type ConfirmedMapping } from '../dataAgentWriter'

const MAPPINGS: ConfirmedMapping[] = [
  { source_column_name: 'Email', target_type: 'standard_field', target_field_key: 'email', metadata: {} },
  { source_column_name: 'Phone', target_type: 'standard_field', target_field_key: 'phone', metadata: { country_code_presence: 'mixed' } },
  { source_column_name: 'Notes', target_type: 'custom_field', target_field_key: 'custom_notes', metadata: {} },
  { source_column_name: 'Email Opt-Out', target_type: 'tag', target_field_key: 'dnd_email', metadata: { dnd_channel: 'email' } },
  { source_column_name: 'Middle Name', target_type: 'ignored', target_field_key: null, metadata: {} },
]

describe('applyDefaultCountryCode', () => {
  it('leaves a value with a leading + untouched', () => {
    expect(applyDefaultCountryCode('+14155551234', '+65')).toBe('+14155551234')
  })
  it('prepends the default when missing, stripping one leading zero', () => {
    expect(applyDefaultCountryCode('091234567', '+65')).toBe('+6591234567')
  })
  it('returns the raw value unchanged when no default is configured', () => {
    expect(applyDefaultCountryCode('91234567', null)).toBe('91234567')
  })
  it('REVIEW FINDING: strips a leading zero correctly even when the raw value has leading whitespace', () => {
    expect(applyDefaultCountryCode(' 091234567', '+65')).toBe('+6591234567')
  })
})

describe('buildGhlFields', () => {
  const row = { Email: 'jane@x.com', Phone: '91234567', Notes: 'VIP client', 'Email Opt-Out': 'yes', 'Middle Name': 'Q' }

  it('places standard fields, custom fields, and tags into their own buckets', () => {
    const built = buildGhlFields(row, MAPPINGS, '+65')
    expect(built.standardFields).toEqual({ email: 'jane@x.com', phone: '+6591234567' })
    expect(built.customFields).toEqual([{ id: 'custom_notes', value: 'VIP client' }])
    expect(built.tags).toEqual(['dnd_email'])
  })

  it('skips an ignored column entirely', () => {
    const built = buildGhlFields(row, MAPPINGS, '+65')
    expect(JSON.stringify(built)).not.toContain('Q')
  })

  it('skips a blank value rather than writing an empty string', () => {
    const built = buildGhlFields({ ...row, Notes: '' }, MAPPINGS, '+65')
    expect(built.customFields).toEqual([])
  })

  it('does not throw for a row missing one of the mapped columns entirely', () => {
    const sparse = { Email: 'jane@x.com' }
    expect(() => buildGhlFields(sparse, MAPPINGS, '+65')).not.toThrow()
  })

  it('REVIEW FINDING: treats a whitespace-only value as blank too, consistent with getFieldValue', () => {
    const built = buildGhlFields({ ...row, Notes: '   ' }, MAPPINGS, '+65')
    expect(built.customFields).toEqual([])
  })

  it('REVIEW FINDING: does not apply a DND/opt-out tag when the column\'s own value reads as falsy (common CSV boolean-export convention)', () => {
    for (const falsy of ['no', 'false', '0', 'N', 'Off']) {
      const built = buildGhlFields({ ...row, 'Email Opt-Out': falsy }, MAPPINGS, '+65')
      expect(built.tags).toEqual([])
    }
  })

  it('REVIEW FINDING: does not apply a phone country-code prefix to a "Work Email" column just because its subtype keyword also appears in phone subtypes', () => {
    const mappings: ConfirmedMapping[] = [
      { source_column_name: 'Work Email', target_type: 'standard_field', target_field_key: 'email', metadata: { subtype: 'work' } },
    ]
    const built = buildGhlFields({ 'Work Email': 'jane@acme.com' }, mappings, '+65')
    expect(built.standardFields.email).toBe('jane@acme.com')
  })

  describe('tag_source: value — the cell itself is a list of tag names', () => {
    const tagsMapping: ConfirmedMapping[] = [
      { source_column_name: 'Tags', target_type: 'tag', target_field_key: 'Tags', metadata: { tag_source: 'value' } },
    ]

    it('REGRESSION: splits a comma-separated cell into several real tags, not one literal tag containing commas', () => {
      const built = buildGhlFields({ Tags: 'VIP, Newsletter, Spring2026' }, tagsMapping, null)
      expect(built.tags).toEqual(['VIP', 'Newsletter', 'Spring2026'])
    })

    it('trims whitespace around each tag piece', () => {
      const built = buildGhlFields({ Tags: '  VIP ,Newsletter  ,  Spring2026' }, tagsMapping, null)
      expect(built.tags).toEqual(['VIP', 'Newsletter', 'Spring2026'])
    })

    it('handles a single tag with no commas the same as a comma-separated list', () => {
      const built = buildGhlFields({ Tags: 'VIP' }, tagsMapping, null)
      expect(built.tags).toEqual(['VIP'])
    })

    it('drops empty pieces from stray/doubled commas rather than pushing a blank tag', () => {
      const built = buildGhlFields({ Tags: 'VIP,, Newsletter,' }, tagsMapping, null)
      expect(built.tags).toEqual(['VIP', 'Newsletter'])
    })

    it('does NOT fall back to the falsy-value check that fixed-mode tags use — "no" is a real tag name in value mode, not an opt-out indicator', () => {
      const built = buildGhlFields({ Tags: 'no' }, tagsMapping, null)
      expect(built.tags).toEqual(['no'])
    })

    it('a blank cell still applies no tags at all', () => {
      const built = buildGhlFields({ Tags: '' }, tagsMapping, null)
      expect(built.tags).toEqual([])
    })
  })

  it('a tag mapping with no tag_source set (every DND mapping that predates this field) keeps the original fixed-tag behavior unchanged', () => {
    const legacyDndMapping: ConfirmedMapping[] = [
      { source_column_name: 'Email Opt-Out', target_type: 'tag', target_field_key: 'dnd_email', metadata: { dnd_channel: 'email' } },
    ]
    const built = buildGhlFields({ 'Email Opt-Out': 'yes' }, legacyDndMapping, null)
    expect(built.tags).toEqual(['dnd_email'])
  })
})

describe('getFieldValue', () => {
  it('resolves a target field key back to its source column value', () => {
    expect(getFieldValue({ Email: 'jane@x.com' }, MAPPINGS, 'email')).toBe('jane@x.com')
  })
  it('returns null when the value is blank', () => {
    expect(getFieldValue({ Email: '' }, MAPPINGS, 'email')).toBeNull()
  })
  it('returns null when no mapping targets that field key', () => {
    expect(getFieldValue({ Email: 'jane@x.com' }, MAPPINGS, 'nonexistent')).toBeNull()
  })
})

describe('isBlankBuiltFields', () => {
  it('REVIEW FINDING: is true when every bucket is empty, so a fully-blank row can be skipped rather than written as an empty GHL record', () => {
    expect(isBlankBuiltFields({ standardFields: {}, customFields: [], tags: [] })).toBe(true)
  })
  it('is false if any bucket has content', () => {
    expect(isBlankBuiltFields({ standardFields: { email: 'a@x.com' }, customFields: [], tags: [] })).toBe(false)
    expect(isBlankBuiltFields({ standardFields: {}, customFields: [{ id: 'x', value: 'y' }], tags: [] })).toBe(false)
    expect(isBlankBuiltFields({ standardFields: {}, customFields: [], tags: ['dnd_email'] })).toBe(false)
  })
})

// supabase/functions/_shared/__tests__/dataAgentWriter.test.ts (part 2 of 2 — batch writing)
import { writeRecordBatch, type GhlRecordWriter, type BatchRow, type BatchWriteResult } from '../dataAgentWriter'
import { GhlRateLimitError, GhlTransientError } from '../dataAgentGhlClient'

function createStatefulWriter() {
  const store = new Map<string, { id: string; fields: Record<string, unknown> }>()
  let nextId = 1
  const writer: GhlRecordWriter = {
    async findExisting(matchValue) {
      const existing = store.get(matchValue)
      return existing ? { id: existing.id, currentFields: existing.fields } : null
    },
    async create(fields) {
      const id = `c${nextId++}`
      store.set(fields.email as string, { id, fields })
      return { id }
    },
    async replace(id, fields) {
      const key = [...store.entries()].find(([, v]) => v.id === id)?.[0]
      if (key) store.set(key, { id, fields })
    },
  }
  return { writer, store }
}

describe('writeRecordBatch', () => {
  it('creates a record with no prior match and records a null snapshot', async () => {
    const { writer } = createStatefulWriter()
    const rows: BatchRow[] = [{ recordId: 'r1', matchValue: 'new@x.com', fields: { email: 'new@x.com' } }]
    const [result] = await writeRecordBatch(rows, writer)
    expect(result).toMatchObject({ writeStatus: 'created', preReplaceSnapshot: null })
  })

  it('REVIEW FOCUS #3: captures each duplicate row\'s snapshot from the state right before THAT row\'s own write, not the original pre-upload state', async () => {
    const { writer } = createStatefulWriter()
    await writer.create({ email: 'dup@x.com', name: 'Original' }) // pre-existing, before this migration

    const rows: BatchRow[] = [
      { recordId: 'r1', matchValue: 'dup@x.com', fields: { email: 'dup@x.com', name: 'From Row 1' } },
      { recordId: 'r2', matchValue: 'dup@x.com', fields: { email: 'dup@x.com', name: 'From Row 2' } },
    ]
    const results = await writeRecordBatch(rows, writer)

    expect(results[0]).toMatchObject({ writeStatus: 'replaced', preReplaceSnapshot: { email: 'dup@x.com', name: 'Original' } })
    // Row 2's snapshot must reflect row 1's write — undoing row 2 alone
    // must not resurrect "Original", which row 1 already legitimately overwrote.
    expect(results[1]).toMatchObject({ writeStatus: 'replaced', preReplaceSnapshot: { email: 'dup@x.com', name: 'From Row 1' } })
  })

  it('REVIEW FOCUS #2: marks a genuine validation error as failed, leaves a 429 pending for retry, and lets other rows continue regardless', async () => {
    const writer: GhlRecordWriter = {
      async findExisting() { return null },
      async create(fields) {
        if (fields.email === 'bad@x.com') throw new Error('GHL contact upsert failed: 422 invalid email')
        if (fields.email === 'limited@x.com') throw new GhlRateLimitError('rate limited')
        return { id: 'ok-1' }
      },
      async replace() {},
    }
    const rows: BatchRow[] = [
      { recordId: 'r1', matchValue: null, fields: { email: 'bad@x.com' } },
      { recordId: 'r2', matchValue: null, fields: { email: 'limited@x.com' } },
      { recordId: 'r3', matchValue: null, fields: { email: 'good@x.com' } },
    ]
    const results = await writeRecordBatch(rows, writer)

    expect(results[0]).toMatchObject({ writeStatus: 'failed' })
    expect(results[0].errorMessage).toMatch(/422/)
    expect(results[1]).toMatchObject({ writeStatus: 'pending' }) // left for retry, never "failed"
    expect(results[2]).toMatchObject({ writeStatus: 'created' }) // row 3 unaffected by rows 1-2
  })

  it('treats a GhlTransientError exactly like a rate limit — left pending for retry, not failed', async () => {
    const writer: GhlRecordWriter = {
      async findExisting() { return null },
      async create() { throw new GhlTransientError('GHL request to /contacts/upsert failed: network error') },
      async replace() {},
    }
    const rows: BatchRow[] = [{ recordId: 'r1', matchValue: null, fields: { email: 'x@x.com' } }]
    const [result] = await writeRecordBatch(rows, writer)
    expect(result).toMatchObject({ writeStatus: 'pending' })
  })

  it('REGRESSION: calls onResult immediately after each row, not just once at the end — a caller persisting results per-row must see row 1 before row 2 is even attempted', async () => {
    const seenAtCallTime: string[] = []
    const writer: GhlRecordWriter = {
      async findExisting() { return null },
      async create(fields) {
        // If onResult for the previous row hasn't fired yet by the time this
        // row's own create() runs, the batch is still processing them
        // without writing back in between — exactly the bug this callback
        // exists to fix.
        seenAtCallTime.push([...callbackOrder].join(','))
        return { id: fields.email as string }
      },
      async replace() {},
    }
    const callbackOrder: string[] = []
    const rows: BatchRow[] = [
      { recordId: 'r1', matchValue: null, fields: { email: 'r1' } },
      { recordId: 'r2', matchValue: null, fields: { email: 'r2' } },
    ]
    const onResult = vi.fn(async (result: BatchWriteResult) => { callbackOrder.push(result.recordId) })
    await writeRecordBatch(rows, writer, onResult)
    expect(onResult).toHaveBeenCalledTimes(2)
    expect(onResult.mock.calls[0][0]).toMatchObject({ recordId: 'r1', writeStatus: 'created' })
    expect(onResult.mock.calls[1][0]).toMatchObject({ recordId: 'r2', writeStatus: 'created' })
    // row 2's create() ran only after row 1's onResult had already fired.
    expect(seenAtCallTime).toEqual(['', 'r1'])
  })

  it('calls onResult for a failed and a pending row too, not just successes', async () => {
    const writer: GhlRecordWriter = {
      async findExisting() { return null },
      async create(fields) {
        if (fields.email === 'bad@x.com') throw new Error('422')
        throw new GhlRateLimitError('rate limited')
      },
      async replace() {},
    }
    const rows: BatchRow[] = [
      { recordId: 'r1', matchValue: null, fields: { email: 'bad@x.com' } },
      { recordId: 'r2', matchValue: null, fields: { email: 'limited@x.com' } },
    ]
    const onResult = vi.fn()
    await writeRecordBatch(rows, writer, onResult)
    expect(onResult).toHaveBeenCalledTimes(2)
    expect(onResult.mock.calls[0][0]).toMatchObject({ writeStatus: 'failed' })
    expect(onResult.mock.calls[1][0]).toMatchObject({ writeStatus: 'pending' })
  })
})
