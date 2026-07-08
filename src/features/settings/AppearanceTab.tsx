import { useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { getStoredTheme, getStoredColor, setTheme, setBrandColor, DEFAULT_COLOR } from '@/lib/theme'
import type { ThemeMode } from '@/lib/theme'

const PRESET_COLORS = [
  { label: 'Violet',  value: '#7c3aed' },
  { label: 'Blue',    value: '#2563eb' },
  { label: 'Indigo',  value: '#4338ca' },
  { label: 'Sky',     value: '#0284c7' },
  { label: 'Teal',    value: '#0d9488' },
  { label: 'Green',   value: '#16a34a' },
  { label: 'Orange',  value: '#ea580c' },
  { label: 'Rose',    value: '#e11d48' },
  { label: 'Pink',    value: '#db2777' },
  { label: 'Fuchsia', value: '#a21caf' },
]

const THEMES: { id: ThemeMode; label: string; icon: string; desc: string }[] = [
  { id: 'light',  label: 'Light',  icon: '☀️', desc: 'Clean, bright interface' },
  { id: 'dark',   label: 'Dark',   icon: '🌙', desc: 'Easy on the eyes at night' },
  { id: 'system', label: 'System', icon: '💻', desc: 'Follows your OS setting' },
]

export function AppearanceTab() {
  const { user } = useAuth()
  const isSuperAdmin = user?.role === 'Super-admin'

  const [mode, setMode] = useState<ThemeMode>(getStoredTheme)
  const [color, setColor] = useState(getStoredColor)

  function handleTheme(m: ThemeMode) {
    setMode(m)
    setTheme(m)
  }

  function handleColor(c: string) {
    setColor(c)
    setBrandColor(c)
  }

  function handleReset() {
    setColor(DEFAULT_COLOR)
    setBrandColor(DEFAULT_COLOR)
  }

  return (
    <div className="max-w-2xl space-y-6">

      {/* Theme Mode */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Theme</h2>
        <p className="text-sm text-gray-500 mb-4">Choose how DIGITRACKER looks for you.</p>

        <div className="grid grid-cols-3 gap-3">
          {THEMES.map(t => (
            <button
              key={t.id}
              onClick={() => handleTheme(t.id)}
              className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${
                mode === t.id
                  ? 'border-violet-600 bg-violet-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <span className="text-2xl">{t.icon}</span>
              <span className="text-sm font-medium text-gray-900">{t.label}</span>
              <span className="text-xs text-gray-500 text-center">{t.desc}</span>
              {mode === t.id && (
                <span className="text-xs font-semibold text-violet-600">Active</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Brand Color — Super-admin only */}
      {isSuperAdmin && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-lg font-semibold text-gray-900">Brand Color</h2>
            <button
              onClick={handleReset}
              className="text-xs text-gray-400 hover:text-gray-600 underline"
            >
              Reset to default
            </button>
          </div>
          <p className="text-sm text-gray-500 mb-4">
            Sets the accent color across buttons, highlights, and navigation. Applied globally.
          </p>

          {/* Preset swatches */}
          <div className="flex flex-wrap gap-3 mb-4">
            {PRESET_COLORS.map(c => (
              <button
                key={c.value}
                title={c.label}
                onClick={() => handleColor(c.value)}
                style={{ backgroundColor: c.value }}
                className={`w-9 h-9 rounded-full transition-all hover:scale-110 ${
                  color === c.value ? 'ring-2 ring-offset-2 ring-gray-800 scale-110' : ''
                }`}
              />
            ))}
          </div>

          {/* Custom color input */}
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-gray-700 shrink-0">Custom color:</label>
            <input
              type="color"
              value={color}
              onChange={e => handleColor(e.target.value)}
              className="w-10 h-10 rounded-lg border border-gray-300 cursor-pointer p-0.5"
            />
            <input
              type="text"
              value={color}
              onChange={e => {
                const v = e.target.value
                if (/^#[0-9a-fA-F]{0,6}$/.test(v)) handleColor(v)
              }}
              maxLength={7}
              className="w-28 border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
            <div
              style={{ backgroundColor: color }}
              className="flex-1 h-9 rounded-lg border border-gray-200 transition-colors"
            />
          </div>

          <div className="mt-4 p-3 bg-gray-50 rounded-lg">
            <p className="text-xs text-gray-500">Preview — how your brand color appears on interactive elements:</p>
            <div className="flex items-center gap-3 mt-2">
              <button style={{ backgroundColor: color }} className="text-white text-sm px-4 py-1.5 rounded-lg font-medium">Button</button>
              <span style={{ color }} className="text-sm font-medium underline cursor-pointer">Link text</span>
              <span style={{ backgroundColor: color + '20', color }} className="text-xs font-semibold px-2.5 py-1 rounded-full">Badge</span>
            </div>
          </div>
        </div>
      )}

      {!isSuperAdmin && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
          <p className="text-sm text-gray-500">Brand color settings are available to Super-admins only.</p>
        </div>
      )}
    </div>
  )
}
