import { useState } from 'react'
import { getStoredTheme, setTheme } from '@/lib/theme'
import type { ThemeMode } from '@/lib/theme'

const THEMES: { id: ThemeMode; label: string; icon: string; desc: string }[] = [
  { id: 'light',  label: 'Light',  icon: '☀️', desc: 'Clean, bright interface' },
  { id: 'dark',   label: 'Dark',   icon: '🌙', desc: 'Easy on the eyes at night' },
  { id: 'system', label: 'System', icon: '💻', desc: 'Follows your OS setting' },
]

export function AppearanceTab() {
  const [mode, setMode] = useState<ThemeMode>(getStoredTheme)

  function handleTheme(m: ThemeMode) {
    setMode(m)
    setTheme(m)
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
    </div>
  )
}
