export type ThemeMode = 'light' | 'dark' | 'system'

const THEME_KEY = 'dt-theme'
export const DEFAULT_COLOR = '#2563eb'

const BRAND_SHADES: Record<number, { mix: 'white' | 'black'; amount: number }> = {
  50: { mix: 'white', amount: 0.96 },
  100: { mix: 'white', amount: 0.92 },
  200: { mix: 'white', amount: 0.82 },
  300: { mix: 'white', amount: 0.68 },
  400: { mix: 'white', amount: 0.48 },
  500: { mix: 'white', amount: 0.25 },
  600: { mix: 'black', amount: 0 },
  700: { mix: 'black', amount: 0.14 },
  800: { mix: 'black', amount: 0.3 },
  900: { mix: 'black', amount: 0.46 },
  950: { mix: 'black', amount: 0.6 },
}

export function getStoredTheme(): ThemeMode {
  const stored = localStorage.getItem(THEME_KEY)
  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'light'
}

export function isValidBrandColor(color: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(color)
}

export function applyTheme(mode: ThemeMode) {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const isDark = mode === 'dark' || (mode === 'system' && prefersDark)
  document.documentElement.classList.toggle('dark', isDark)
}

export function applyBrandColor(color: string) {
  if (!isValidBrandColor(color)) {
    throw new Error('Brand color must be a six-digit hex color.')
  }

  const channels = [0, 2, 4].map(start => Number.parseInt(color.slice(start + 1, start + 3), 16))
  document.documentElement.style.setProperty('--color-brand', color)

  for (const [shade, { mix, amount }] of Object.entries(BRAND_SHADES)) {
    const mixed = channels.map(channel => Math.round(
      mix === 'white'
        ? channel + (255 - channel) * amount
        : channel * (1 - amount)
    ))
    document.documentElement.style.setProperty(`--color-brand-${shade}`, mixed.join(' '))
  }
}

export function setTheme(mode: ThemeMode) {
  localStorage.setItem(THEME_KEY, mode)
  applyTheme(mode)
}

export function initTheme() {
  applyTheme(getStoredTheme())
  applyBrandColor(DEFAULT_COLOR)
}
