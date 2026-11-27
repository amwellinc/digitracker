import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { useSubAccountTimezone } from '@/hooks/useSubAccountTimezone'
import { supabase } from '@/lib/supabase'
import { todayInTz } from '@/lib/timezone'
import type { TimeLog } from '@/types'
import { Modal } from '@/components/ui/Modal'

interface CorrectionRequest {
  id: string
  time_log_id: string
  requested_total_minutes: number
  status: 'pending' | 'approved' | 'rejected'
  review_note: string | null
  created_at: string
}

function monthRange(offset: number, timezone: string) {
  const [year, month] = todayInTz(timezone).split('-').map(Number)
  const first = new Date(Date.UTC(year, month - 1 + offset, 1))
  const last = new Date(Date.UTC(year, month + offset, 0))
  return {
    from: first.toISOString().slice(0, 10),
    to: last.toISOString().slice(0, 10),
    label: first.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }),
  }
}

function formatBusinessDate(date: string) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-SG', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
}

function formatTime(timestamp: string | null, timezone: string) {
  if (!timestamp) return '—'
  return new Date(timestamp).toLocaleTimeString('en-SG', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone,
  })
}

function formatMinutes(minutes: number) {
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`
}

export function TimesheetPage() {
  const { user } = useAuth()
  const timezone = useSubAccountTimezone()
  const [monthOffset, setMonthOffset] = useState(0)
  const range = monthRange(monthOffset, timezone)
  const [logs, setLogs] = useState<TimeLog[]>([])
  const [requests, setRequests] = useState<CorrectionRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedLog, setSelectedLog] = useState<TimeLog | null>(null)

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    setLoadError(null)

    const [logResult, requestResult] = await Promise.all([
      supabase
        .from('time_logs')
        .select('*')
        .eq('user_id', user.id)
        .eq('status', 'clocked_out')
        .gte('date', range.from)
        .lte('date', range.to)
        .order('date', { ascending: false })
        .order('clock_in', { ascending: false }),
      supabase
        .from('time_log_correction_requests')
        .select('id, time_log_id, requested_total_minutes, status, review_note, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false }),
    ])

    if (logResult.error || requestResult.error) {
      setLoadError(`Could not load your timesheet: ${(logResult.error ?? requestResult.error)!.message}`)
      setLoading(false)
      return
    }

    setLogs((logResult.data ?? []) as TimeLog[])
    setRequests((requestResult.data ?? []) as CorrectionRequest[])
    setLoading(false)
  }, [user, range.from, range.to])

  useEffect(() => { void load() }, [load])

  const requestByLog = new Map<string, CorrectionRequest>()
  for (const request of requests) {
    if (!requestByLog.has(request.time_log_id)) requestByLog.set(request.time_log_id, request)
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-violet-600">Personal records</p>
          <h1 className="text-2xl font-bold text-gray-900 mt-0.5">My Timesheet</h1>
          <p className="text-sm text-gray-500 mt-1">
            Review completed shifts and request a correction if your recorded hours are wrong.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={monthOffset < 0}
            onClick={() => setMonthOffset(-1)}
            className="btn-ghost"
          >
            Previous month
          </button>
          {monthOffset < 0 && (
            <button type="button" onClick={() => setMonthOffset(0)} className="btn-ghost">
              This month
            </button>
          )}
        </div>
      </div>

      <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Completed shifts</h2>
            <p className="text-xs text-gray-500 mt-0.5">{range.label}</p>
          </div>
          <span className="text-xs text-gray-500">{logs.length} shifts</span>
        </div>

        {loadError && (
          <p role="alert" className="px-5 py-3 text-sm text-red-700 bg-red-50">{loadError}</p>
        )}
        {loading ? (
          <div className="py-12 text-center text-sm text-gray-400">Loading timesheet…</div>
        ) : logs.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-500">
            No completed shifts found for {range.label}.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs font-medium text-gray-500">
                <tr>
                  <th className="text-left px-5 py-3">Date</th>
                  <th className="text-left px-5 py-3">Clock in</th>
                  <th className="text-left px-5 py-3">Clock out</th>
                  <th className="text-right px-5 py-3">Recorded time</th>
                  <th className="text-right px-5 py-3">Review</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {logs.map(log => {
                  const request = requestByLog.get(log.id)
                  return (
                    <tr key={log.id} className="hover:bg-gray-50">
                      <td className="px-5 py-3 font-medium text-gray-800">{formatBusinessDate(log.date)}</td>
                      <td className="px-5 py-3 text-gray-600">{formatTime(log.clock_in, timezone)}</td>
                      <td className="px-5 py-3 text-gray-600">{formatTime(log.clock_out, timezone)}</td>
                      <td className="px-5 py-3 text-right font-mono font-semibold text-gray-900">
                        {formatMinutes(Number(log.total_minutes))}
                      </td>
                      <td className="px-5 py-3 text-right">
                        {request?.status === 'pending' ? (
                          <span className="text-xs font-semibold text-amber-700">Pending review</span>
                        ) : request ? (
                          <span className={`text-xs font-semibold ${request.status === 'approved' ? 'text-emerald-700' : 'text-red-600'}`}>
                            {request.status === 'approved' ? 'Approved' : 'Declined'}
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setSelectedLog(log)}
                            className="text-xs font-semibold text-violet-700 hover:text-violet-900"
                          >
                            Request correction
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selectedLog && (
        <CorrectionRequestModal
          log={selectedLog}
          timezone={timezone}
          onClose={() => setSelectedLog(null)}
          onSuccess={() => {
            setSelectedLog(null)
            void load()
          }}
        />
      )}
    </div>
  )
}

function CorrectionRequestModal({
  log,
  timezone,
  onClose,
  onSuccess,
}: {
  log: TimeLog
  timezone: string
  onClose: () => void
  onSuccess: () => void
}) {
  const { user } = useAuth()
  const [hours, setHours] = useState((Number(log.total_minutes) / 60).toFixed(2))
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!user) return

    const requestedHours = Number(hours)
    const requestedMinutes = Math.round(requestedHours * 60)
    if (!Number.isFinite(requestedHours) || requestedMinutes < 1 || requestedMinutes > 1440) {
      setError('Enter corrected time between 1 minute and 24 hours.')
      return
    }
    if (requestedMinutes === Number(log.total_minutes)) {
      setError('Enter a corrected total that differs from the current record.')
      return
    }
    if (reason.trim().length < 5) {
      setError('Explain the correction in at least 5 characters.')
      return
    }

    setSaving(true)
    setError(null)
    const { error: insertError } = await supabase
      .from('time_log_correction_requests')
      .insert({
        time_log_id: log.id,
        user_id: user.id,
        requested_by: user.id,
        requested_total_minutes: requestedMinutes,
        reason: reason.trim(),
      })
    setSaving(false)
    if (insertError) {
      setError(`Could not submit correction request: ${insertError.message}`)
      return
    }
    onSuccess()
  }

  return (
    <Modal title="Request a time correction" onClose={onClose}>
      <form id="time-correction-form" onSubmit={submit} className="space-y-4">
        <div className="rounded-lg bg-gray-50 p-3 text-sm">
          <p className="font-medium text-gray-800">{formatBusinessDate(log.date)}</p>
          <p className="text-gray-500 mt-1">
            {formatTime(log.clock_in, timezone)}–{formatTime(log.clock_out, timezone)} · Current total {formatMinutes(Number(log.total_minutes))}
          </p>
        </div>
        <p className="text-xs text-gray-500">
          This request changes the total recorded hours only. Your original record is preserved for review.
        </p>
        <div>
          <label htmlFor="corrected-hours" className="block text-sm font-medium text-gray-700 mb-1">
            Correct total hours
          </label>
          <input
            id="corrected-hours"
            type="number"
            min="0.02"
            max="24"
            step="0.01"
            required
            value={hours}
            onChange={e => setHours(e.target.value)}
            className="input"
          />
        </div>
        <div>
          <label htmlFor="correction-reason" className="block text-sm font-medium text-gray-700 mb-1">
            Reason for correction
          </label>
          <textarea
            id="correction-reason"
            required
            minLength={5}
            maxLength={2000}
            rows={3}
            value={reason}
            onChange={e => setReason(e.target.value)}
            className="input resize-y"
            placeholder="Describe what was recorded incorrectly."
          />
        </div>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      </form>
      <div className="flex justify-end gap-2 mt-4">
        <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
        <button type="submit" form="time-correction-form" disabled={saving} className="btn-primary">
          {saving ? 'Submitting…' : 'Submit request'}
        </button>
      </div>
    </Modal>
  )
}
