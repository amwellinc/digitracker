import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { todayInTz, DEFAULT_TIMEZONE } from '@/lib/timezone'
import type { User } from '@/types'

interface Props {
  onClose: () => void
  onSuccess: () => void
  // When set, an Admin/Manager is filing this request on behalf of one of
  // their assigned users instead of themselves.
  targetUser?: User
}

type LeaveType = 'Annual' | 'Medical' | 'Time-off'

function today() {
  return todayInTz(DEFAULT_TIMEZONE)
}

export function RequestLeaveModal({ onClose, onSuccess, targetUser }: Props) {
  const { user } = useAuth()
  const [type, setType] = useState<LeaveType>('Annual')
  const [startDate, setStartDate] = useState(today())
  const [endDate, setEndDate] = useState(today())
  const [hours, setHours] = useState(1)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [autoConverted, setAutoConverted] = useState(false)

  function handleTypeChange(t: LeaveType) {
    setType(t)
    setAutoConverted(false)
    if (t === 'Time-off') setEndDate(startDate)
  }

  function handleHoursChange(v: number) {
    if (v > 4) {
      setType('Annual')
      setAutoConverted(true)
      return
    }
    setAutoConverted(false)
    setHours(Math.max(1, v))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!user) return
    setError(null)
    setSaving(true)

    const payload = {
      user_id: targetUser?.id ?? user.id,
      type,
      start_date: startDate,
      end_date: type === 'Time-off' ? startDate : endDate,
      hours: type === 'Time-off' ? hours : null,
      reason: reason.trim(),
      status: 'pending',
    }

    const { error: err } = await supabase.from('leave_requests').insert(payload)
    setSaving(false)
    if (err) { setError(err.message); return }
    onSuccess()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold text-gray-900">Request Leave</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>
        {targetUser && (
          <p className="text-sm text-gray-500 mb-4">
            On behalf of <span className="font-medium text-gray-800">{targetUser.name}</span>
          </p>
        )}
        {!targetUser && <div className="mb-4" />}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Leave Type</label>
            <div className="flex gap-2">
              {(['Annual', 'Medical', 'Time-off'] as LeaveType[]).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => handleTypeChange(t)}
                  className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium border transition-colors ${
                    type === t
                      ? 'bg-violet-600 text-white border-violet-600'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-violet-300'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Auto-converted notice */}
          {autoConverted && (
            <div className="bg-amber-50 border border-amber-200 text-amber-700 rounded-lg px-3 py-2 text-sm">
              Time-off max is 4 hours. Switched to <strong>Annual Leave</strong> (full day).
            </div>
          )}

          {/* Date(s) */}
          {type === 'Time-off' ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
              <input
                type="date"
                value={startDate}
                min={today()}
                onChange={e => setStartDate(e.target.value)}
                required
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                <input
                  type="date"
                  value={startDate}
                  min={today()}
                  onChange={e => { setStartDate(e.target.value); if (e.target.value > endDate) setEndDate(e.target.value) }}
                  required
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
                <input
                  type="date"
                  value={endDate}
                  min={startDate}
                  onChange={e => setEndDate(e.target.value)}
                  required
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              </div>
            </div>
          )}

          {/* Hours (Time-off only) */}
          {type === 'Time-off' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Hours <span className="text-gray-400 font-normal">(min 1, max 4)</span>
              </label>
              <input
                type="number"
                value={hours}
                min={1}
                max={4}
                step={0.5}
                onChange={e => handleHoursChange(Number(e.target.value))}
                required
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
              <p className="text-xs text-gray-400 mt-1">Entering more than 4 hours automatically converts to Annual Leave</p>
            </div>
          )}

          {/* Reason */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Reason</label>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              rows={3}
              required
              placeholder="Brief reason for your leave request..."
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none"
            />
          </div>

          {error && (
            <p className="text-red-500 text-sm">{error}</p>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-2.5 rounded-xl bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 disabled:opacity-50"
            >
              {saving ? 'Submitting…' : 'Submit Request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
