// supabase/functions/_shared/dataAgentMatching.ts
//
// Zero-import, runtime-agnostic (spec §14: "the rules tier is pure,
// deterministic logic... this is the highest-value test surface given the
// accuracy-first requirement"). Never add an import statement to this file
// — doing so breaks the Vitest-under-Node / Deno-edge-function dual use
// this module exists for.

export type TargetFieldType = 'standard' | 'custom'
export interface TargetField {
  key: string    // e.g. 'phone', or a GHL custom field's id/fieldKey
  label: string   // e.g. 'Phone', 'Mobile Phone'
  type: TargetFieldType
}

export type PhoneEmailSubtype = 'mobile' | 'home' | 'work' | 'fax' | 'other'
export type DndChannel = 'call' | 'email' | 'sms'
export type CountryCodePresence = 'present' | 'absent' | 'mixed'

export interface SourceProfileEntry {
  source_system: 'salesforce' | 'hubspot'
  pattern: string                        // exact source export column name (case-sensitive)
  target_field_hint: string               // target field key to map to
  subtype_hint: PhoneEmailSubtype | null
}

export interface ColumnClassificationMetadata {
  subtype?: PhoneEmailSubtype
  dnd_channel?: DndChannel
  country_code_presence?: CountryCodePresence
  is_primary_candidate?: boolean // set by the caller (Task 8's planner), never by classifyColumn itself
}

export interface ColumnClassification {
  status: 'mapped' | 'uncertain' | 'unmapped'
  mapped_by: 'rule' | 'source_profile' | 'claude' | null
  target_field_key: string | null
  target_type: 'standard_field' | 'custom_field' | 'tag' | 'ignored'
  confidence: number | null
  metadata: ColumnClassificationMetadata
}

export function normalizeColumnName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function hasAnyKeyword(normalized: string, keywords: string[]): boolean {
  return keywords.some(k => normalized.includes(k))
}

const COUNTRY_CODE_RE = /^\s*\+\d/

export function detectCountryCodePresence(sampleValues: string[]): CountryCodePresence {
  const nonEmpty = sampleValues.filter(v => v != null && v.trim().length > 0)
  if (nonEmpty.length === 0) return 'absent'
  const withCode = nonEmpty.filter(v => COUNTRY_CODE_RE.test(v))
  if (withCode.length === nonEmpty.length) return 'present'
  if (withCode.length === 0) return 'absent'
  return 'mixed'
}

const DND_CHANNEL_KEYWORDS: Array<[DndChannel, string[]]> = [
  ['email', ['emailoptout', 'emaildnd', 'donotemail', 'unsubscribe']],
  ['call', ['donotcall', 'calldnd', 'nocall']],
  ['sms', ['smsoptout', 'smsdnd', 'donottext', 'textoptout']],
]

// An unambiguous channel-specific keyword is itself a confident rule match
// (spec §6.1: "A column like 'Email Opt-Out' maps to the email channel
// specifically"). A generic "do not contact" matches none of these and
// correctly falls through to the Claude tier instead ("is ambiguous across
// channels and is routed to the Claude tier rather than assumed to mean
// 'all channels'").
export function detectDndChannel(columnName: string): DndChannel | null {
  const normalized = normalizeColumnName(columnName)
  for (const [channel, keywords] of DND_CHANNEL_KEYWORDS) {
    if (hasAnyKeyword(normalized, keywords)) return channel
  }
  return null
}

const PHONE_BASE_KEYWORDS = ['phone', 'tel', 'fax']
const EMAIL_BASE_KEYWORDS = ['email', 'mail']
// Unambiguous on their own even with no base keyword present (a column
// just named "Mobile" or "Cell") — unlike "Home" or "Work" alone, which
// are equally plausible as address fields and require a base keyword too.
const UNAMBIGUOUS_PHONE_MODIFIERS = ['mobile', 'cell']

// 'fax' checked first: it's a wholly unambiguous substring (no other
// subtype's keywords contain "fax" and "fax" contains none of theirs), so
// checking it first costs nothing and resolves a real collision —
// "Office Fax" normalizes to "officefax", which contains both "office"
// (a 'work' keyword) and "fax"; checking 'work' first would wrongly
// classify it as a work-phone column before 'fax' is ever considered.
const SUBTYPE_KEYWORDS: Array<[PhoneEmailSubtype, string[]]> = [
  ['fax', ['fax']],
  ['mobile', ['mobile', 'cell']],
  ['work', ['work', 'office', 'business']],
  ['home', ['home']],
]

export interface PhoneEmailSubtypeResult { base: 'phone' | 'email'; subtype: PhoneEmailSubtype }

export function detectPhoneEmailSubtype(columnName: string): PhoneEmailSubtypeResult | null {
  const normalized = normalizeColumnName(columnName)
  const hasPhoneBase = hasAnyKeyword(normalized, PHONE_BASE_KEYWORDS)
  const hasEmailBase = hasAnyKeyword(normalized, EMAIL_BASE_KEYWORDS)
  const hasUnambiguousPhoneModifier = hasAnyKeyword(normalized, UNAMBIGUOUS_PHONE_MODIFIERS)
  if (!hasPhoneBase && !hasEmailBase && !hasUnambiguousPhoneModifier) return null

  for (const [subtype, keywords] of SUBTYPE_KEYWORDS) {
    if (!hasAnyKeyword(normalized, keywords)) continue
    if (hasEmailBase && !hasPhoneBase) return { base: 'email', subtype }
    return { base: 'phone', subtype }
  }
  return null
}

// Never invents a field: only resolves to a custom field that actually
// exists in the cached schema, by label. If nothing matches, the caller
// must leave the column unmapped rather than guess a field key.
export function resolveSubtypeTargetField(result: PhoneEmailSubtypeResult, targetFields: TargetField[]): TargetField | null {
  const subtypeKeywords = SUBTYPE_KEYWORDS.find(([s]) => s === result.subtype)![1]
  // "Fax" alone is already unambiguous — unlike mobile/home/work, which
  // need a phone/email base word on the target field's own label to avoid
  // matching an unrelated field, a field labeled just "Fax" is definitely
  // a fax field with no base word required.
  const wantedBaseWords = result.subtype === 'fax' ? [] : (result.base === 'phone' ? ['phone', 'tel'] : ['email', 'mail'])
  return targetFields.find(f => {
    const normalized = normalizeColumnName(f.label)
    const hasBase = wantedBaseWords.length === 0 || hasAnyKeyword(normalized, wantedBaseWords)
    return hasBase && hasAnyKeyword(normalized, subtypeKeywords)
  }) ?? null
}

export function matchTargetSchema(columnName: string, targetFields: TargetField[]): TargetField | null {
  const normalized = normalizeColumnName(columnName)
  return targetFields.find(f => normalizeColumnName(f.label) === normalized || normalizeColumnName(f.key) === normalized) ?? null
}

// Case-sensitive on purpose: a profile entry encodes specific prior
// knowledge of a source's exact export column spelling, not a fuzzy guess.
export function matchSourceProfile(columnName: string, sourceSystem: 'salesforce' | 'hubspot' | null, profiles: SourceProfileEntry[]): SourceProfileEntry | null {
  if (!sourceSystem) return null
  return profiles.find(p => p.source_system === sourceSystem && p.pattern === columnName) ?? null
}

export interface PhoneEmailColumn { columnName: string; subtype: PhoneEmailSubtype | null }
const SUBTYPE_PRIORITY: Record<PhoneEmailSubtype, number> = { mobile: 0, work: 1, home: 2, other: 3, fax: 4 }

// GHL's contact object has exactly one primary phone/email field. Given
// several phone- or email-like columns, picks which becomes primary
// (mobile > work > home > other > fax); the rest stay mapped as their own
// custom fields (spec §6.1 step 4).
export function pickPrimaryPhoneEmailColumn(columns: PhoneEmailColumn[]): string | null {
  if (columns.length === 0) return null
  const sorted = [...columns].sort((a, b) => {
    const pa = a.subtype ? SUBTYPE_PRIORITY[a.subtype] : 99
    const pb = b.subtype ? SUBTYPE_PRIORITY[b.subtype] : 99
    return pa - pb
  })
  return sorted[0].columnName
}

export interface ClassifyColumnInput {
  columnName: string
  sampleValues: string[]
  sourceSystem: 'salesforce' | 'hubspot' | null
  targetFields: TargetField[]
  sourceProfiles: SourceProfileEntry[]
}

export function classifyColumn(input: ClassifyColumnInput): ColumnClassification {
  const { columnName, sampleValues, sourceSystem, targetFields, sourceProfiles } = input

  // 1. Source-profile match (most specific prior knowledge).
  const profileMatch = matchSourceProfile(columnName, sourceSystem, sourceProfiles)
  if (profileMatch) {
    const metadata: ColumnClassificationMetadata = {}
    if (profileMatch.subtype_hint) {
      metadata.subtype = profileMatch.subtype_hint
      metadata.country_code_presence = detectCountryCodePresence(sampleValues)
    }
    // Look the hint up against the real target schema rather than
    // assuming it's always a custom field — a profile's target_field_hint
    // can legitimately be a standard field key (e.g. 'email', 'phone'),
    // and hardcoding 'custom_field' here sent those columns into
    // customFields instead of the real standard field downstream, so the
    // contact's actual email/phone was never populated.
    const hintedField = targetFields.find(f => f.key === profileMatch.target_field_hint)
    return { status: 'mapped', mapped_by: 'source_profile', target_field_key: profileMatch.target_field_hint, target_type: hintedField?.type === 'standard' ? 'standard_field' : 'custom_field', confidence: 1, metadata }
  }

  // 2. Exact/near-exact match against the target object's real schema.
  const schemaMatch = matchTargetSchema(columnName, targetFields)
  if (schemaMatch) {
    const metadata: ColumnClassificationMetadata = {}
    const subtype = detectPhoneEmailSubtype(columnName)
    if (subtype) metadata.subtype = subtype.subtype
    if (schemaMatch.key === 'phone' || schemaMatch.key === 'email' || subtype) {
      metadata.country_code_presence = detectCountryCodePresence(sampleValues)
    }
    return {
      status: 'mapped', mapped_by: 'rule', target_field_key: schemaMatch.key,
      target_type: schemaMatch.type === 'standard' ? 'standard_field' : 'custom_field',
      confidence: 1, metadata,
    }
  }

  // 3. Generic pattern detection — an unambiguous DND channel or
  // phone/email subtype keyword, even with no schema/profile hit.
  const dndChannel = detectDndChannel(columnName)
  if (dndChannel) {
    return { status: 'mapped', mapped_by: 'rule', target_field_key: `dnd_${dndChannel}`, target_type: 'tag', confidence: 1, metadata: { dnd_channel: dndChannel } }
  }

  const subtypeResult = detectPhoneEmailSubtype(columnName)
  if (subtypeResult) {
    const metadata: ColumnClassificationMetadata = { subtype: subtypeResult.subtype }
    if (subtypeResult.base === 'phone') metadata.country_code_presence = detectCountryCodePresence(sampleValues)
    const resolvedField = resolveSubtypeTargetField(subtypeResult, targetFields)
    if (resolvedField) {
      return { status: 'mapped', mapped_by: 'rule', target_field_key: resolvedField.key, target_type: resolvedField.type === 'standard' ? 'standard_field' : 'custom_field', confidence: 1, metadata }
    }
    // Detected a subtype but no matching field exists in the real schema —
    // never invent one. Falls through to unmapped/Claude tier with the
    // detected metadata preserved for that tier's context.
    return { status: 'unmapped', mapped_by: null, target_field_key: null, target_type: 'ignored', confidence: null, metadata }
  }

  // Neither tier found a plausible match — the caller (Task 8's upload
  // function) routes this to the Claude tier (Task 11/12) before it can
  // ever surface to the user as unmapped/red.
  return { status: 'unmapped', mapped_by: null, target_field_key: null, target_type: 'ignored', confidence: null, metadata: {} }
}
