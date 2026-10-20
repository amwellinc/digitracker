// supabase/functions/_shared/__tests__/dataAgentMatching.test.ts
import { describe, it, expect } from 'vitest'
import {
  normalizeColumnName, detectCountryCodePresence, detectDndChannel, detectPhoneEmailSubtype,
  resolveSubtypeTargetField, matchTargetSchema, matchSourceProfile, pickPrimaryPhoneEmailColumn,
  classifyColumn, type TargetField, type SourceProfileEntry,
} from '../dataAgentMatching'

const GHL_CONTACT_FIELDS: TargetField[] = [
  { key: 'firstName', label: 'First Name', type: 'standard' },
  { key: 'lastName', label: 'Last Name', type: 'standard' },
  { key: 'email', label: 'Email', type: 'standard' },
  { key: 'phone', label: 'Phone', type: 'standard' },
  { key: 'custom_mobile_phone', label: 'Mobile Phone', type: 'custom' },
  { key: 'custom_work_phone', label: 'Work Phone', type: 'custom' },
  { key: 'custom_fax', label: 'Fax', type: 'custom' },
]

const SALESFORCE_PROFILES: SourceProfileEntry[] = [
  { source_system: 'salesforce', pattern: 'MobilePhone', target_field_hint: 'custom_mobile_phone', subtype_hint: 'mobile' },
  { source_system: 'salesforce', pattern: 'HasOptedOutOfEmail', target_field_hint: 'dnd_email', subtype_hint: null },
]

describe('normalizeColumnName', () => {
  it('lowercases, trims, and strips punctuation/whitespace', () => {
    expect(normalizeColumnName('  Mobile Phone  ')).toBe('mobilephone')
    expect(normalizeColumnName('E-Mail_Address')).toBe('emailaddress')
  })
})

describe('detectCountryCodePresence', () => {
  it('is present when every non-empty value has a leading +', () => {
    expect(detectCountryCodePresence(['+14155551234', '+6591234567'])).toBe('present')
  })
  it('is absent when no value has one', () => {
    expect(detectCountryCodePresence(['4155551234', '91234567'])).toBe('absent')
  })
  it('is mixed when some do and some do not', () => {
    expect(detectCountryCodePresence(['+14155551234', '91234567'])).toBe('mixed')
  })
  it('ignores blank values and treats an all-blank column as absent', () => {
    expect(detectCountryCodePresence(['', '  ', ''])).toBe('absent')
  })
})

describe('detectDndChannel', () => {
  it('maps "Email Opt-Out" to the email channel', () => {
    expect(detectDndChannel('Email Opt-Out')).toBe('email')
  })
  it('maps "Do Not Call" to the call channel', () => {
    expect(detectDndChannel('Do Not Call')).toBe('call')
  })
  it('maps "SMS Opt Out" to the sms channel', () => {
    expect(detectDndChannel('SMS Opt Out')).toBe('sms')
  })
  it('returns null for an ambiguous generic "Do Not Contact"', () => {
    expect(detectDndChannel('Do Not Contact')).toBeNull()
  })
})

describe('detectPhoneEmailSubtype', () => {
  it('detects "HomePhone" as phone/home', () => {
    expect(detectPhoneEmailSubtype('HomePhone')).toEqual({ base: 'phone', subtype: 'home' })
  })
  it('detects "Work Email" as email/work', () => {
    expect(detectPhoneEmailSubtype('Work Email')).toEqual({ base: 'email', subtype: 'work' })
  })
  it('detects the unambiguous modifier "Mobile" alone as phone/mobile', () => {
    expect(detectPhoneEmailSubtype('Mobile')).toEqual({ base: 'phone', subtype: 'mobile' })
  })
  it('detects "Cell" alone as phone/mobile', () => {
    expect(detectPhoneEmailSubtype('Cell')).toEqual({ base: 'phone', subtype: 'mobile' })
  })
  it('detects "Fax" as phone/fax', () => {
    expect(detectPhoneEmailSubtype('Fax')).toEqual({ base: 'phone', subtype: 'fax' })
  })
  it('does not treat ambiguous "Home" alone (no base keyword) as a phone subtype', () => {
    expect(detectPhoneEmailSubtype('Home')).toBeNull()
  })
  it('does not treat ambiguous "Work" alone as a phone or email subtype', () => {
    expect(detectPhoneEmailSubtype('Work')).toBeNull()
  })
  it('returns null for a column name with no phone/email signal at all', () => {
    expect(detectPhoneEmailSubtype('Company Name')).toBeNull()
  })
})

describe('resolveSubtypeTargetField', () => {
  it('finds an existing "Mobile Phone" custom field for a phone/mobile subtype', () => {
    const field = resolveSubtypeTargetField({ base: 'phone', subtype: 'mobile' }, GHL_CONTACT_FIELDS)
    expect(field?.key).toBe('custom_mobile_phone')
  })
  it('returns null rather than inventing a field when none matches (phone/home has no custom field here)', () => {
    expect(resolveSubtypeTargetField({ base: 'phone', subtype: 'home' }, GHL_CONTACT_FIELDS)).toBeNull()
  })
  it('resolves a fax-subtype column to a field labeled just "Fax", with no phone/tel base word required on the field label', () => {
    const field = resolveSubtypeTargetField({ base: 'phone', subtype: 'fax' }, GHL_CONTACT_FIELDS)
    expect(field?.key).toBe('custom_fax')
  })
})

describe('matchTargetSchema', () => {
  it('matches by label case/whitespace-insensitively', () => {
    expect(matchTargetSchema('  phone  ', GHL_CONTACT_FIELDS)?.key).toBe('phone')
  })
  it('matches by key when the label differs', () => {
    expect(matchTargetSchema('firstName', GHL_CONTACT_FIELDS)?.key).toBe('firstName')
  })
  it('returns null when nothing matches', () => {
    expect(matchTargetSchema('Favorite Color', GHL_CONTACT_FIELDS)).toBeNull()
  })
})

describe('matchSourceProfile', () => {
  it('matches a known Salesforce export column exactly', () => {
    expect(matchSourceProfile('MobilePhone', 'salesforce', SALESFORCE_PROFILES)?.target_field_hint).toBe('custom_mobile_phone')
  })
  it('is case-sensitive — "mobilephone" does not match "MobilePhone"', () => {
    expect(matchSourceProfile('mobilephone', 'salesforce', SALESFORCE_PROFILES)).toBeNull()
  })
  it('returns null when no source system was selected, even if the pattern would match', () => {
    expect(matchSourceProfile('MobilePhone', null, SALESFORCE_PROFILES)).toBeNull()
  })
})

describe('pickPrimaryPhoneEmailColumn', () => {
  it('prefers mobile over work over home over fax', () => {
    const cols = [
      { columnName: 'Home Phone', subtype: 'home' as const },
      { columnName: 'Fax', subtype: 'fax' as const },
      { columnName: 'Mobile', subtype: 'mobile' as const },
      { columnName: 'Work Phone', subtype: 'work' as const },
    ]
    expect(pickPrimaryPhoneEmailColumn(cols)).toBe('Mobile')
  })
  it('returns null for an empty list', () => {
    expect(pickPrimaryPhoneEmailColumn([])).toBeNull()
  })
})

describe('classifyColumn', () => {
  const base = { sampleValues: ['x', 'y'], sourceSystem: null as 'salesforce' | 'hubspot' | null, targetFields: GHL_CONTACT_FIELDS, sourceProfiles: [] as SourceProfileEntry[] }

  it('green-maps an exact standard field match', () => {
    const result = classifyColumn({ ...base, columnName: 'Email' })
    expect(result).toEqual({ status: 'mapped', mapped_by: 'rule', target_field_key: 'email', target_type: 'standard_field', confidence: 1, metadata: { country_code_presence: 'absent' } })
  })

  it('green-maps via a source profile when a source system is selected, even though the name would not fuzzy-match the schema', () => {
    const result = classifyColumn({ ...base, columnName: 'MobilePhone', sourceSystem: 'salesforce', sourceProfiles: SALESFORCE_PROFILES, sampleValues: ['+14155551234'] })
    expect(result.status).toBe('mapped')
    expect(result.mapped_by).toBe('source_profile')
    expect(result.target_field_key).toBe('custom_mobile_phone')
    expect(result.metadata.subtype).toBe('mobile')
  })

  it('REVIEW FINDING: a source-profile hint pointing at a real standard field gets target_type standard_field, not custom_field', () => {
    const profiles: SourceProfileEntry[] = [{ source_system: 'salesforce', pattern: 'EmailAddress', target_field_hint: 'email', subtype_hint: null }]
    const result = classifyColumn({ ...base, columnName: 'EmailAddress', sourceSystem: 'salesforce', sourceProfiles: profiles })
    expect(result.mapped_by).toBe('source_profile')
    expect(result.target_type).toBe('standard_field')
    expect(result.target_field_key).toBe('email')
  })

  it('REVIEW FINDING: a source-profile hint that does not resolve to any real field falls through to unmapped instead of fabricating a custom_field key', () => {
    // target_field_hint values in the seed data (e.g. 'custom_mobile_phone',
    // 'dnd_email') are written against GHL's typical field *labels*, not
    // real field ids — a live tenant's actual custom field ids are random
    // GHL-generated strings, so the hint essentially never resolves in
    // production. The old behavior returned status: 'mapped', confidence: 1
    // anyway with target_type: 'custom_field' and target_field_key set to
    // the unresolved hint itself — auto-confirming green with no human
    // review, then silently dropping the value (or failing the row) once
    // the worker sent an unknown field id to GHL. For a DND/opt-out hint
    // specifically, that meant losing the record of a contact's opt-out.
    const profiles: SourceProfileEntry[] = [
      { source_system: 'salesforce', pattern: 'HasOptedOutOfEmail', target_field_hint: 'dnd_email', subtype_hint: null },
    ]
    const result = classifyColumn({ ...base, columnName: 'HasOptedOutOfEmail', sourceSystem: 'salesforce', sourceProfiles: profiles })
    expect(result.mapped_by).not.toBe('source_profile')
    expect(result.target_field_key).not.toBe('dnd_email')
  })

  it('green-maps an unambiguous DND channel column with no schema/profile hit', () => {
    const result = classifyColumn({ ...base, columnName: 'Email Opt-Out' })
    // tag_source: 'fixed' — a DND column is a boolean-ish indicator, never
    // a list of tag names, so the fixed dnd_email tag text applies
    // whenever the cell is truthy, never the cell's own raw content.
    expect(result).toEqual({ status: 'mapped', mapped_by: 'rule', target_field_key: 'dnd_email', target_type: 'tag', confidence: 1, metadata: { dnd_channel: 'email', tag_source: 'fixed' } })
  })

  it('green-maps a subtype column to an existing matching custom field', () => {
    const result = classifyColumn({ ...base, columnName: 'Mobile Number', sampleValues: ['+14155551234'] })
    expect(result.status).toBe('mapped')
    expect(result.target_field_key).toBe('custom_mobile_phone')
  })

  it('green-maps a non-exact fax-subtype column name (not the literal "Fax") to the existing fax custom field', () => {
    // "Office Fax" doesn't exact-match the schema's "Fax" label (step 2), so
    // this only passes through resolveSubtypeTargetField's fax-specific
    // base-word exemption (step 3) — a regression here would silently
    // reintroduce the under-mapping bug that exemption fixes. It also pins
    // the SUBTYPE_KEYWORDS ordering fix: "officefax" contains both "office"
    // (a 'work' trigger) and "fax" — if 'fax' weren't checked first, this
    // would wrongly resolve to a work-phone field instead.
    const result = classifyColumn({ ...base, columnName: 'Office Fax' })
    expect(result.status).toBe('mapped')
    expect(result.target_field_key).toBe('custom_fax')
  })

  it('routes an ambiguous "Do Not Contact" column to unmapped rather than guessing a channel', () => {
    const result = classifyColumn({ ...base, columnName: 'Do Not Contact' })
    expect(result.status).toBe('unmapped')
  })

  it('routes a detected-but-unresolvable subtype (no matching field exists) to unmapped, preserving metadata', () => {
    const result = classifyColumn({ ...base, columnName: 'Home Phone', sampleValues: ['4155551234'] })
    expect(result.status).toBe('unmapped')
    expect(result.metadata.subtype).toBe('home')
  })

  it('routes a column with no plausible match at all to unmapped', () => {
    const result = classifyColumn({ ...base, columnName: 'Favorite Color' })
    expect(result).toEqual({ status: 'unmapped', mapped_by: null, target_field_key: null, target_type: 'ignored', confidence: null, metadata: {} })
  })

  it('does not throw and still returns a defined status for a column whose sample values are all blank', () => {
    const result = classifyColumn({ ...base, columnName: 'Middle Name', sampleValues: ['', '', ''] })
    expect(['mapped', 'uncertain', 'unmapped']).toContain(result.status)
  })
})
