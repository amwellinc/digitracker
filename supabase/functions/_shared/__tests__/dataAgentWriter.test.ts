// supabase/functions/_shared/__tests__/dataAgentWriter.test.ts (part 1 of 2 — field building)
import { describe, it, expect } from 'vitest'
import { buildGhlFields, getFieldValue, applyDefaultCountryCode, type ConfirmedMapping } from '../dataAgentWriter'

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

// supabase/functions/_shared/__tests__/dataAgentWriter.test.ts (part 2 of 2 — batch writing)
import { writeRecordBatch, type GhlRecordWriter, type BatchRow } from '../dataAgentWriter'
import { GhlRateLimitError } from '../dataAgentGhlClient'

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
})
