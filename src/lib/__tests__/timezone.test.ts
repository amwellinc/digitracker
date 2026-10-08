import { describe, it, expect } from 'vitest'
import { TIMEZONE_OPTIONS, DEFAULT_TIMEZONE, todayInTz } from '../timezone'

describe('TIMEZONE_OPTIONS', () => {
  it('covers far more than the old 24-zone shortlist, including Europe/Prague', () => {
    expect(TIMEZONE_OPTIONS.length).toBeGreaterThan(100)
    expect(TIMEZONE_OPTIONS.some(z => z.value === 'Europe/Prague')).toBe(true)
  })

  it('formats the label from the IANA path, replacing underscores with spaces', () => {
    const prague = TIMEZONE_OPTIONS.find(z => z.value === 'Europe/Prague')
    expect(prague?.label).toBe('Europe / Prague')
    const nyc = TIMEZONE_OPTIONS.find(z => z.value === 'America/New_York')
    expect(nyc?.label).toBe('America / New York')
  })

  it('has no duplicate zone values', () => {
    const values = TIMEZONE_OPTIONS.map(z => z.value)
    expect(new Set(values).size).toBe(values.length)
  })

  it('is sorted alphabetically by label', () => {
    const labels = TIMEZONE_OPTIONS.map(z => z.label)
    const sorted = [...labels].sort((a, b) => a.localeCompare(b))
    expect(labels).toEqual(sorted)
  })

  it('still includes the default timezone', () => {
    expect(TIMEZONE_OPTIONS.some(z => z.value === DEFAULT_TIMEZONE)).toBe(true)
  })
})

describe('todayInTz', () => {
  it('returns a YYYY-MM-DD string for a valid IANA zone', () => {
    expect(todayInTz('Europe/Prague')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('falls back to local date formatting for an invalid zone instead of throwing', () => {
    expect(todayInTz('Not/AZone')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
