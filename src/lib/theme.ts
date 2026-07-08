export type ThemeMode = 'light' | 'dark' | 'system'

const THEME_KEY = 'dt-theme'
const COLOR_KEY = 'dt-brand-color'
export const DEFAULT_COLOR = '#7c3aed'

export function getStoredTheme(): ThemeMode {
  return (localStorage.getItem(THEME_KEY) as ThemeMode) ?? 'light'
}

export function getStoredColor(): string {
  return localStorage.getItem(COLOR_KEY) ?? DEFAULT_COLOR
}

export function applyTheme(mode: ThemeMode) {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const isDark = mode === 'dark' || (mode === 'system' && prefersDark)
  document.documentElement.classList.toggle('dark', isDark)
}

export function applyColor(color: string) {
  document.documentElement.style.setProperty('--color-brand', color)
}

export function setTheme(mode: ThemeMode) {
  localStorage.setItem(THEME_KEY, mode)
  applyTheme(mode)
}

export function setBrandColor(color: string) {
  localStorage.setItem(COLOR_KEY, color)
  applyColor(color)
}

export function initTheme() {
  applyTheme(getStoredTheme())
  applyColor(getStoredColor())
}
