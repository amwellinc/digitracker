import { useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import { MyCalendarTab } from './MyCalendarTab'
import { TeamCalendarTab } from './TeamCalendarTab'
import { UserCalendarTab } from './UserCalendarTab'
import { MonthlyReportsTab } from './MonthlyReportsTab'

type TabId = 'my' | 'team' | 'user' | 'reports'

const COUNTRIES = ['SG', 'MY', 'PH'] as const
type Country = typeof COUNTRIES[number]

function PublicHolidayModal({ subAccount, onClose }: { subAccount: string; onClose: () => void }) {
  const [date, setDate] = useState('')
  const [name, setName] = useState('')
  const [country, setCountry] = useState<Country>('SG')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    const { error } = await supabase.from('public_holidays').insert({
      date, name: name.trim(), country, sub_account: subAccount,
    })
    setSaving(false)
    if (error) { setMsg(error.message); return }
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">Add Public Holiday</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
        </div>
        <form onSubmit={handleSave} className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
            <input type="date" required value={date} onChange={e => setDate(e.target.value)} className="input" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Holiday Name</label>
            <input
              required value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. National Day, Hari Raya…"
              className="input"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Country</label>
            <select value={country} onChange={e => setCountry(e.target.value as Country)} className="input">
              <option value="SG">🇸🇬 Singapore (SG)</option>
              <option value="MY">🇲🇾 Malaysia (MY)</option>
              <option value="PH">🇵🇭 Philippines (PH)</option>
            </select>
          </div>
          {msg && <p className="text-sm text-red-600">{msg}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? 'Adding…' : 'Add Holiday'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export function CalendarPage() {
  const { user } = useAuth()
  const [tab, setTab] = useState<TabId>('my')
  const [showModal, setShowModal] = useState(false)

  const isSuperAdmin = user?.role === 'Admin' || user?.role === 'Super-Admin'
  const isManager    = user?.role === 'Manager'

  const tabs: { id: TabId; label: string }[] = [
    { id: 'my',      label: 'My Calendar' },
    ...(isSuperAdmin || isManager ? [{ id: 'team' as TabId, label: 'All Users (Team)' }] : []),
    ...(isSuperAdmin ? [
      { id: 'user'    as TabId, label: 'User Calendar' },
      { id: 'reports' as TabId, label: 'User Monthly Reports' },
    ] : []),
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Activity Calendar</h1>
          <p className="text-sm text-gray-500 mt-1">View attendance, schedules, and reports.</p>
        </div>
        {isSuperAdmin && (
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 bg-violet-600 text-white rounded-xl px-5 py-2.5 text-sm font-semibold hover:bg-violet-700 transition-colors shadow-sm"
          >
            <span className="text-base leading-none">+</span> Add Public Holiday
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex gap-6">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                tab === t.id
                  ? 'border-violet-600 text-violet-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      {tab === 'my'      && <MyCalendarTab />}
      {tab === 'team'    && <TeamCalendarTab />}
      {tab === 'user'    && isSuperAdmin && <UserCalendarTab />}
      {tab === 'reports' && isSuperAdmin && <MonthlyReportsTab />}

      {showModal && user && (
        <PublicHolidayModal subAccount={user.sub_account} onClose={() => setShowModal(false)} />
      )}
    </div>
  )
}
