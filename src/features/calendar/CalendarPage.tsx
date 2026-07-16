import { useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { useSubAccountTimezone } from '@/hooks/useSubAccountTimezone'
import { supabase } from '@/lib/supabase'
import { MyCalendarTab } from './MyCalendarTab'
import { TeamCalendarTab } from './TeamCalendarTab'
import { UserCalendarTab } from './UserCalendarTab'
import { MonthlyReportsTab } from './MonthlyReportsTab'

type TabId = 'my' | 'team' | 'user' | 'reports'

function countryFromTimezone(tz: string): 'SG' | 'MY' | 'PH' {
  if (tz.includes('Kuala_Lumpur') || tz.includes('Malaysia')) return 'MY'
  if (tz.includes('Manila') || tz.includes('Philippines')) return 'PH'
  return 'SG'
}

function PublicHolidayModal({ subAccount, timezone, onClose }: { subAccount: string; timezone: string; onClose: () => void }) {
  const [date, setDate] = useState('')
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    const country = countryFromTimezone(timezone)
    const { error } = await supabase.from('public_holidays').insert({
      date, name: name.trim(), country, sub_account: subAccount,
    })
    if (error) { setMsg(error.message); setSaving(false); return }

    // Notify all users in this sub-account
    const { data: members } = await supabase
      .from('users')
      .select('id')
      .eq('sub_account', subAccount)
    if (members && members.length > 0) {
      const fmtd = new Date(date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
      await supabase.from('notifications').insert(
        members.map(m => ({
          user_id: (m as { id: string }).id,
          type: 'holiday_added',
          message: `Public holiday added: "${name.trim()}" on ${fmtd}`,
          read: false,
        }))
      )
    }

    setSaving(false)
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
          <p className="text-xs text-gray-500 bg-violet-50 border border-violet-100 rounded-lg px-3 py-2">
            This holiday will appear on all team members' calendars in your workspace.
          </p>
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
  const timezone = useSubAccountTimezone()
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
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Activity Calendar</h1>
          <p className="text-sm text-gray-500 mt-1">
            View attendance, schedules, and reports.
            <span className="ml-2 text-xs text-gray-400 font-mono">{timezone}</span>
          </p>
        </div>
        {(isSuperAdmin || isManager) && (
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 bg-violet-600 text-white rounded-xl px-4 py-2.5 text-sm font-semibold hover:bg-violet-700 transition-colors self-start"
            style={{ minHeight: '44px' }}
          >
            + Add Holiday
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex gap-2 sm:gap-6 overflow-x-auto scrollbar-hide pb-px">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors whitespace-nowrap flex-shrink-0 ${
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

      {/* Tab Content — timezone threaded to every tab */}
      {tab === 'my'      && <MyCalendarTab timezone={timezone} />}
      {tab === 'team'    && <TeamCalendarTab timezone={timezone} />}
      {tab === 'user'    && isSuperAdmin && <UserCalendarTab timezone={timezone} />}
      {tab === 'reports' && isSuperAdmin && <MonthlyReportsTab timezone={timezone} />}

      {showModal && user && (isSuperAdmin || isManager) && (
        <PublicHolidayModal subAccount={user.sub_account} timezone={timezone} onClose={() => setShowModal(false)} />
      )}
    </div>
  )
}
