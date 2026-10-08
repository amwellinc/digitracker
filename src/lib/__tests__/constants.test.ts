import { describe, it, expect } from 'vitest'
import { COUNTRY_OPTIONS } from '../constants'

describe('COUNTRY_OPTIONS', () => {
  it('covers far more than the old 13-country shortlist, including Czech Republic', () => {
    expect(COUNTRY_OPTIONS.length).toBeGreaterThan(100)
    const cz = COUNTRY_OPTIONS.find(c => c.code === 'CZ')
    expect(cz).toBeDefined()
    expect(cz!.label.toLowerCase()).toMatch(/czech|czechia/)
    expect(cz!.flag).toBe('🇨🇿')
    expect(cz!.dialCode).toBe('+420')
  })

  it('keeps every entry in the shape existing selectors (CountrySelect, PhoneInput) rely on', () => {
    for (const c of COUNTRY_OPTIONS) {
      expect(c.code).toMatch(/^[A-Z]{2}$/)
      expect(typeof c.label).toBe('string')
      expect(c.label.length).toBeGreaterThan(0)
      expect(typeof c.flag).toBe('string')
      expect(typeof c.dialCode).toBe('string')
    }
  })

  it('has no duplicate country codes', () => {
    const codes = COUNTRY_OPTIONS.map(c => c.code)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('is sorted alphabetically by label', () => {
    const labels = COUNTRY_OPTIONS.map(c => c.label)
    const sorted = [...labels].sort((a, b) => a.localeCompare(b))
    expect(labels).toEqual(sorted)
  })

  it('still includes every country from the original shortlist', () => {
    for (const code of ['SG', 'MY', 'PH', 'IN', 'AU', 'US', 'GB', 'ID', 'TH', 'VN', 'AE', 'CN', 'JP']) {
      expect(COUNTRY_OPTIONS.some(c => c.code === code)).toBe(true)
    }
  })
})
