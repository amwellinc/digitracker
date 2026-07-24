import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import type { LeaveRequest, User } from '@/types'
import { RequestLeaveModal } from './RequestLeaveModal'

function fmtDate(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })
}

function diffDays(start: string, end: string) {
  const ms = new Date(end + 'T00:00:00').getTime() - new Date(start + 'T00:00:00').getTime()
  return Math.max(1, Math.round(ms / 86400000) + 1)
}

function fmtRange(start: string, end: string) {
  const fmt = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  return start === end ? fmt(start) : `${fmt(start)} – ${fmt(end)}`
}

const STATUS_STYLE: Record<string, string> = {
  pending:  'bg-amber-50 text-amber-700 border border-amber-200',
  approved: 'bg-green-50 text-green-700 border border-green-200',
  rejected: 'bg-red-50 text-red-700 border border-red-200',
}

// ─── Reject Modal ─────────────────────────────────────────────────────────────
interface RejectTarget { id: string; memberName: string }

function RejectModal({
  target, onConfirm, onCancel,
}: {
  target: RejectTarget
  onConfirm: (id: string, remarks: string) => Promise<void>
  onCancel: () => void
}) {
  const [remarks, setRemarks] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true)
    await onConfirm(target.id, remarks.trim())
    setBusy(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={e => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">Reject Leave Request</h3>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <p className="text-sm text-gray-600">
            Rejecting leave request for <strong>{target.memberName}</strong>.
            Add a remark to explain the decision (optional).
          </p>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Rejection Remarks
            </label>
            <textarea
              value={remarks}
              onChange={e => setRemarks(e.target.value)}
              rows={3}
              placeholder="e.g. Insufficient notice period, project deadline conflict…"
              className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>
          <div className="flex justify-end gap-3 pt-1">
            <button onClick={onCancel} className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800">
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={busy}
              className="px-5 py-2 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-50 transition-colors"
            >
              {busy ? 'Rejecting…' : 'Confirm Reject'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────
export function ManageLeaveTab() {
  const { user } = useAuth()
  const [leaves, setLeaves] = useState<LeaveRequest[]>([])
  const [memberMap, setMemberMap] = useState<Record<string, User>>({})
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending')
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rejectTarget, setRejectTarget] = useState<RejectTarget | null>(null)
  const [requestForId, setRequestForId] = useState('')
  const [showRequestModal, setShowRequestModal] = useState(false)

  const load = useCallback(async () => {
    if (!user) return

    if (user.role === 'Admin' || user.role === 'Super-Admin') {
      const { data: members } = await supabase
        .from('users')
        .select('*')
        .eq('sub_account', user.sub_account)
        .neq('id', user.id)
      const users = (members ?? []) as User[]
      setMemberMap(Object.fromEntries(users.map(u => [u.id, u])))

      const ids = users.map(u => u.id)
      if (ids.length === 0) { setLeaves([]); setLoading(false); return }
      const { data: lv } = await supabase
        .from('leave_requests')
        .select('*')
        .in('user_id', ids)
        .order('created_at', { ascending: false })
      setLeaves((lv ?? []) as LeaveRequest[])
    } else {
      // Manager: their full downline (direct + indirect reports)
      const { data: reports } = await supabase.rpc('get_manager_downline')
      const users = (reports ?? []) as User[]
      setMemberMap(Object.fromEntries(users.map(u => [u.id, u])))

      const ids = users.map(u => u.id)
      if (ids.length === 0) { setLeaves([]); setLoading(false); return }
      const { data: lv } = await supabase
        .from('leave_requests')
        .select('*')
        .in('user_id', ids)
        .order('created_at', { ascending: false })
      setLeaves((lv ?? []) as LeaveRequest[])
    }
    setLoading(false)
  }, [user])

  useEffect(() => { void load() }, [load])

  // Realtime
  useEffect(() => {
    if (!user) return
    const ch = supabase
      .channel('manage-leave-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leave_requests' }, () => void load())
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [user, load])

  // Both the Manager Assigned and any workspace Admin can approve/reject a
  // request — whichever one of them didn't act still needs a record that it
  // was decided, not just the applicant. (This was the reported bug: an
  // Admin approving left the Manager with no record of it at all.)
  async function notifyOtherApprover(leave: LeaveRequest, decision: 'approved' | 'rejected', remarks?: string | null) {
    if (!user) return
    const applicant = memberMap[leave.user_id]
    const recipientIds = new Set<string>()

    if (user.role === 'Manager') {
      const { data: admins } = await supabase
        .from('users')
        .select('id')
        .eq('sub_account', user.sub_account)
        .eq('role', 'Admin')
        .eq('status', 'active')
      for (const a of (admins ?? []) as { id: string }[]) recipientIds.add(a.id)
    } else if (applicant?.manager_id) {
      recipientIds.add(applicant.manager_id)
    }
    recipientIds.delete(user.id)
    if (recipientIds.size === 0) return

    const byWhom = user.role === 'Manager' ? 'the Manager' : 'Admin'
    const dateStr = fmtRange(leave.start_date, leave.end_date)
    const message = remarks
      ? `${applicant?.name ?? 'A team member'}'s ${leave.type} leave request (${dateStr}) was ${decision} by ${byWhom}. Reason: ${remarks}`
      : `${applicant?.name ?? 'A team member'}'s ${leave.type} leave request (${dateStr}) has been ${decision} by ${byWhom}.`

    await supabase.from('notifications').insert(
      Array.from(recipientIds).map(uid => ({
        user_id: uid,
        type: decision === 'approved' ? 'leave_approved' : 'leave_rejected',
        message,
        read: false,
      }))
    )
  }

  async function approve(id: string) {
    setActing(id)
    setError(null)
    const leave = leaves.find(l => l.id === id)
    const { error: err } = await supabase
      .from('leave_requests')
      .update({ status: 'approved', remarks: null })
      .eq('id', id)
    if (err) {
      setError(`Approve failed: ${err.message}`)
    } else {
      if (leave) {
        await supabase.from('notifications').insert({
          user_id: leave.user_id,
          type: 'leave_approved',
          message: `Your ${leave.type} leave request (${fmtRange(leave.start_date, leave.end_date)}) has been approved.`,
          read: false,
        })
        await notifyOtherApprover(leave, 'approved')
      }
      await load()
    }
    setActing(null)
  }

  async function reject(id: string, remarks: string) {
    setActing(id)
    setError(null)
    const leave = leaves.find(l => l.id === id)
    const { error: err } = await supabase
      .from('leave_requests')
      .update({ status: 'rejected', remarks: remarks || null })
      .eq('id', id)
    setRejectTarget(null)
    if (err) {
      setError(`Reject failed: ${err.message}`)
    } else {
      if (leave) {
        await supabase.from('notifications').insert({
          user_id: leave.user_id,
          type: 'leave_rejected',
          message: remarks
            ? `Your ${leave.type} leave request (${fmtRange(leave.start_date, leave.end_date)}) was rejected. Reason: ${remarks}`
            : `Your ${leave.type} leave request (${fmtRange(leave.start_date, leave.end_date)}) has been rejected.`,
          read: false,
        })
        await notifyOtherApprover(leave, 'rejected', remarks || null)
      }
      await load()
    }
    setActing(null)
  }

  const visible = filter === 'all' ? leaves : leaves.filter(l => l.status === filter)
  const pendingCount = leaves.filter(l => l.status === 'pending').length

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-6 h-6 border-4 border-violet-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="space-y-4">
      {/* Header + filter */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-gray-900">Team Leave Requests</h3>
          {pendingCount > 0 && (
            <span className="bg-amber-100 text-amber-700 text-xs font-medium px-2 py-0.5 rounded-full">
              {pendingCount} pending
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex gap-1.5">
            {(['pending', 'approved', 'rejected', 'all'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${
                  filter === f ? 'bg-violet-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
          {Object.values(memberMap).some(m => m.status === 'active') && (
            <div className="flex items-center gap-1.5">
              <select
                value={requestForId}
                onChange={e => setRequestForId(e.target.value)}
                className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-violet-500"
              >
                <option value="">Select team member…</option>
                {Object.values(memberMap).filter(m => m.status === 'active').map(m => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
              <button
                onClick={() => requestForId && setShowRequestModal(true)}
                disabled={!requestForId}
                className="text-xs font-semibold text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg px-3 py-1.5 transition-colors whitespace-nowrap"
              >
                + Request on Behalf
              </button>
            </div>
          )}
        </div>
      </div>

      {showRequestModal && memberMap[requestForId] && (
        <RequestLeaveModal
          targetUser={memberMap[requestForId]}
          onClose={() => setShowRequestModal(false)}
          onSuccess={() => { void load(); setRequestForId('') }}
        />
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 ml-4 text-lg leading-none">&times;</button>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        {visible.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <p className="text-4xl mb-2">✅</p>
            <p className="text-sm">No {filter === 'all' ? '' : filter} leave requests</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  {['Employee', 'Type', 'Date(s)', 'Duration', 'Reason', 'Submitted', 'Status', 'Remarks', 'Action'].map(h => (
                    <th key={h} className="px-4 py-3 text-left font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {visible.map(l => {
                  const member = memberMap[l.user_id]
                  const dur = l.type === 'Time-off'
                    ? `${l.hours}h`
                    : `${diffDays(l.start_date, l.end_date)} day${diffDays(l.start_date, l.end_date) === 1 ? '' : 's'}`
                  return (
                    <tr key={l.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-violet-100 text-violet-700 text-xs font-bold flex items-center justify-center flex-shrink-0">
                            {(member?.name ?? '?').slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <p className="font-medium text-gray-900">{member?.name ?? '—'}</p>
                            <p className="text-xs text-gray-400">{member?.role}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-700 font-medium whitespace-nowrap">{l.type}</td>
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                        {l.type === 'Time-off' || l.start_date === l.end_date
                          ? fmtDate(l.start_date)
                          : `${fmtDate(l.start_date)} – ${fmtDate(l.end_date)}`}
                      </td>
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{dur}</td>
                      <td className="px-4 py-3 text-gray-600 max-w-[160px] truncate" title={l.reason}>{l.reason}</td>
                      <td className="px-4 py-3 text-gray-400 whitespace-nowrap text-xs">
                        {new Date(l.created_at).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_STYLE[l.status]}`}>
                          {l.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs max-w-[160px]">
                        {l.remarks ? (
                          <span className="italic" title={l.remarks}>
                            {l.remarks.length > 60 ? l.remarks.slice(0, 60) + '…' : l.remarks}
                          </span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {l.status === 'pending' && (
                          <div className="flex gap-1.5">
                            <button
                              onClick={() => void approve(l.id)}
                              disabled={acting === l.id}
                              className="px-2.5 py-1 rounded-lg bg-green-600 text-white text-xs font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
                            >
                              {acting === l.id ? '…' : 'Approve'}
                            </button>
                            <button
                              onClick={() => setRejectTarget({ id: l.id, memberName: member?.name ?? 'this employee' })}
                              disabled={acting === l.id}
                              className="px-2.5 py-1 rounded-lg bg-red-500 text-white text-xs font-medium hover:bg-red-600 disabled:opacity-50 transition-colors"
                            >
                              Reject
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {rejectTarget && (
        <RejectModal
          target={rejectTarget}
          onConfirm={reject}
          onCancel={() => setRejectTarget(null)}
        />
      )}
    </div>
  )
}
