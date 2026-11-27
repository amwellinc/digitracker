import { beforeEach, describe, expect, it } from 'vitest'
import { applyBrandColor, isValidBrandColor } from '../theme'

describe('workspace brand color', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('style')
  })

  it('accepts only six-digit hex colors', () => {
    expect(isValidBrandColor('#0d9488')).toBe(true)
    expect(isValidBrandColor('#abc')).toBe(false)
    expect(isValidBrandColor('red')).toBe(false)
  })

  it('sets the brand color and its Tailwind palette channels', () => {
    applyBrandColor('#000000')

    expect(document.documentElement.style.getPropertyValue('--color-brand')).toBe('#000000')
    expect(document.documentElement.style.getPropertyValue('--color-brand-50')).toBe('245 245 245')
    expect(document.documentElement.style.getPropertyValue('--color-brand-600')).toBe('0 0 0')
    expect(document.documentElement.style.getPropertyValue('--color-brand-950')).toBe('0 0 0')
  })

  it('rejects invalid colors instead of applying them', () => {
    expect(() => applyBrandColor('#12')).toThrow('Brand color must be a six-digit hex color.')
  })
})
