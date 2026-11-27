import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useSubAccountTimezone } from '@/hooks/useSubAccountTimezone'
import type { TimeLog } from '@/types'

const STALE_HEARTBEAT_MS = 20 * 60 * 1000
const LONG_SHIFT_MS = 12 * 60 * 60 * 1000

interface CorrectionRow {
  id: string
  user_id: string
  time_log_id: string
  original_total_minutes: number
  requested_total_minutes: number
  reason: string
  created_at: string
  user: { name: string } | null
  time_log: { date: string; clock_in: string; clock_out: string | null } | null
}

interface ActiveSession extends Pick<TimeLog, 'id' | 'user_id' | 'date' | 'clock_in' | 'clock_out' | 'status' | 'last_seen_at'> {
  user: { name: string } | null
}

function formatMinutes(minutes: number) {
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`
}

function formatDate(date: string) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-SG', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
}

function formatTimestamp(timestamp: string | null, timezone: string) {
  if (!timestamp) return 'Not recorded'
  return new Date(timestamp).toLocaleString('en-SG', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone,
  })
}

function sessionException(session: ActiveSession, now: number) {
  const clockInMs = new Date(session.clock_in).getTime()
  const heartbeatAgeMs = session.last_seen_at
    ? now - new Date(session.last_seen_at).getTime()
    : now - clockInMs
  if (now - clockInMs > LONG_SHIFT_MS) return 'Open for over 12 hours'
  if (heartbeatAgeMs > STALE_HEARTBEAT_MS) return 'No heartbeat for 20+ minutes'
  return null
}

export function TimeReviewPage() {
  const timezone = useSubAccountTimezone()
  const [requests, setRequests] = useState<CorrectionRow[]>([])
  const [sessions, setSessions] = useState<ActiveSession[]>([])
  const [now, setNow] = useState(Date.now())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reviewNote, setReviewNote] = useState<Record<string, string>>({})
  const [reviewing, setReviewing] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const [requestResult, sessionResult] = await Promise.all([
      supabase
        .from('time_log_correction_requests')
        .select('id, user_id, time_log_id, original_total_minutes, requested_total_minutes, reason, created_at, user:users!time_log_correction_requests_user_id_fkey(name), time_log:time_logs!time_log_correction_requests_time_log_id_fkey(date, clock_in, clock_out)')
        .eq('status', 'pending')
        .order('created_at', { ascending: true }),
      supabase
        .from('time_logs')
        .select('id, user_id, date, clock_in, clock_out, status, last_seen_at, user:users!time_logs_user_id_fkey(name)')
        .in('status', ['working', 'lunch'])
        .order('clock_in', { ascending: true }),
    ])

    if (requestResult.error || sessionResult.error) {
      setError(`Could not load time review: ${(requestResult.error ?? sessionResult.error)!.message}`)
    }
    setRequests((requestResult.data ?? []) as unknown as CorrectionRow[])
    setSessions((sessionResult.data ?? []) as unknown as ActiveSession[])
    setLoading(false)
    setNow(Date.now())
  }, [])

  useEffect(() => { void load() }, [load])

  async function reviewRequest(id: string, decision: 'approved' | 'rejected') {
    setReviewing(id)
    setError(null)
    const { error: reviewError } = await supabase.rpc('review_time_log_correction', {
      p_request_id: id,
      p_decision: decision,
      p_note: reviewNote[id]?.trim() || null,
    })
    setReviewing(null)
    if (reviewError) {
      setError(`Could not ${decision === 'approved' ? 'approve' : 'decline'} correction: ${reviewError.message}`)
      return
    }
    setReviewNote(current => {
      const next = { ...current }
      delete next[id]
      return next
    })
    await load()
  }

  const exceptions = sessions.filter(session => sessionException(session, now))

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-violet-600">Business operations</p>
          <h1 className="text-2xl font-bold text-gray-900 mt-0.5">Time Review</h1>
          <p className="text-sm text-gray-500 mt-1">
            Review employee corrections and check open sessions that may need attention.
          </p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="btn-ghost self-start sm:self-auto">
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error && <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Correction requests</h2>
            <p className="text-sm text-gray-500 mt-0.5">Approvals update hours only; original values and the decision remain in the audit record.</p>
          </div>
          <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
            {requests.length} pending
          </span>
        </div>
        {loading ? (
          <div className="py-10 text-center text-sm text-gray-400">Loading requests…</div>
        ) : requests.length === 0 ? (
          <div className="py-10 text-center text-sm text-gray-500">No time correction requests need review.</div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {requests.map(request => (
              <li key={request.id} className="p-5">
                <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <h3 className="font-semibold text-gray-900">{request.user?.name ?? 'Employee'}</h3>
                      <span className="text-sm text-gray-500">
                        {request.time_log ? formatDate(request.time_log.date) : 'Time log unavailable'}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600 mt-1">
                      {formatMinutes(Number(request.original_total_minutes))}
                      <span className="mx-2 text-gray-300">→</span>
                      <span className="font-semibold text-gray-900">{formatMinutes(Number(request.requested_total_minutes))}</span>
                    </p>
                    <p className="text-sm text-gray-700 mt-2">{request.reason}</p>
                    <p className="text-xs text-gray-400 mt-2">
                      Submitted {formatTimestamp(request.created_at, timezone)}
                    </p>
                  </div>
                  <div className="w-full lg:w-72 space-y-2">
                    <label className="sr-only" htmlFor={`review-note-${request.id}`}>Decision note</label>
                    <input
                      id={`review-note-${request.id}`}
                      value={reviewNote[request.id] ?? ''}
                      onChange={e => setReviewNote(current => ({ ...current, [request.id]: e.target.value }))}
                      maxLength={2000}
                      placeholder="Optional note for the employee"
                      className="input"
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        disabled={reviewing === request.id}
                        onClick={() => void reviewRequest(request.id, 'rejected')}
                        className="btn-ghost text-red-600"
                      >
                        Decline
                      </button>
                      <button
                        type="button"
                        disabled={reviewing === request.id}
                        onClick={() => void reviewRequest(request.id, 'approved')}
                        className="btn-primary"
                      >
                        {reviewing === request.id ? 'Saving…' : 'Approve'}
                      </button>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Open sessions</h2>
            <p className="text-sm text-gray-500 mt-0.5">Long-running or stale sessions are flagged for a human check; they are never changed automatically here.</p>
          </div>
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${exceptions.length ? 'bg-red-50 text-red-700' : 'bg-gray-100 text-gray-600'}`}>
            {exceptions.length} need attention
          </span>
        </div>
        {loading ? (
          <div className="py-10 text-center text-sm text-gray-400">Loading sessions…</div>
        ) : sessions.length === 0 ? (
          <div className="py-10 text-center text-sm text-gray-500">No one is currently clocked in.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs font-medium text-gray-500">
                <tr>
                  <th className="text-left px-5 py-3">Employee</th>
                  <th className="text-left px-5 py-3">Status</th>
                  <th className="text-left px-5 py-3">Clocked in</th>
                  <th className="text-left px-5 py-3">Last heartbeat</th>
                  <th className="text-left px-5 py-3">Review signal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sessions.map(session => {
                  const exception = sessionException(session, now)
                  return (
                    <tr key={session.id}>
                      <td className="px-5 py-3 font-medium text-gray-900">{session.user?.name ?? 'Employee'}</td>
                      <td className="px-5 py-3 capitalize text-gray-600">{session.status === 'lunch' ? 'On lunch' : 'Working'}</td>
                      <td className="px-5 py-3 text-gray-600">{formatTimestamp(session.clock_in, timezone)}</td>
                      <td className="px-5 py-3 text-gray-600">{formatTimestamp(session.last_seen_at, timezone)}</td>
                      <td className="px-5 py-3">
                        {exception
                          ? <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">{exception}</span>
                          : <span className="text-xs text-emerald-700">No exception</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
