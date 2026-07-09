import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import type { LeaveRequest, User } from '@/types'

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })
}

function diffDays(start: string, end: string) {
  const ms = new Date(end).getTime() - new Date(start).getTime()
  return Math.max(1, Math.round(ms / 86400000) + 1)
}

const STATUS_STYLE: Record<string, string> = {
  pending:  'bg-amber-50 text-amber-700',
  approved: 'bg-green-50 text-green-700',
  rejected: 'bg-red-50 text-red-700',
}

export function ManageLeaveTab() {
  const { user } = useAuth()
  const [leaves, setLeaves] = useState<LeaveRequest[]>([])
  const [memberMap, setMemberMap] = useState<Record<string, User>>({})
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending')
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!user) return

    if (user.role === 'Admin' || user.role === 'Super-Admin') {
      // Fetch all members then all their leaves
      const { data: members } = await supabase
        .from('users')
        .select('*')
        .eq('sub_account', user.sub_account)
        .neq('id', user.id)
      const users = (members ?? []) as User[]
      const map = Object.fromEntries(users.map(u => [u.id, u]))
      setMemberMap(map)

      const ids = users.map(u => u.id)
      if (ids.length === 0) { setLeaves([]); setLoading(false); return }
      const { data: lv } = await supabase
        .from('leave_requests')
        .select('*')
        .in('user_id', ids)
        .order('created_at', { ascending: false })
      setLeaves((lv ?? []) as LeaveRequest[])
    } else {
      // Manager: fetch direct reports
      const { data: reports } = await supabase
        .from('users')
        .select('*')
        .eq('manager_id', user.id)
      const users = (reports ?? []) as User[]
      const map = Object.fromEntries(users.map(u => [u.id, u]))
      setMemberMap(map)

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

  async function decide(id: string, status: 'approved' | 'rejected') {
    setActing(id)
    await supabase.from('leave_requests').update({ status }).eq('id', id)
    setActing(null)
  }

  const visible = filter === 'all' ? leaves : leaves.filter(l => l.status === filter)
  const pendingCount = leaves.filter(l => l.status === 'pending').length

  if (loading) return <div className="flex justify-center py-16"><div className="w-6 h-6 border-4 border-violet-600 border-t-transparent rounded-full animate-spin" /></div>

  return (
    <div className="space-y-4">
      {/* Header + filter */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-gray-900">Team Leave Requests</h3>
          {pendingCount > 0 && (
            <span className="bg-amber-100 text-amber-700 text-xs font-medium px-2 py-0.5 rounded-full">{pendingCount} pending</span>
          )}
        </div>
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
      </div>

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
                  {['Employee', 'Type', 'Date(s)', 'Duration', 'Reason', 'Submitted', 'Status', 'Action'].map(h => (
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
                      <td className="px-4 py-3 text-gray-700 font-medium">{l.type}</td>
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                        {l.type === 'Time-off' || l.start_date === l.end_date
                          ? fmtDate(l.start_date)
                          : `${fmtDate(l.start_date)} – ${fmtDate(l.end_date)}`}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{dur}</td>
                      <td className="px-4 py-3 text-gray-600 max-w-[180px] truncate">{l.reason}</td>
                      <td className="px-4 py-3 text-gray-400 whitespace-nowrap text-xs">
                        {new Date(l.created_at).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_STYLE[l.status]}`}>
                          {l.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {l.status === 'pending' && (
                          <div className="flex gap-1.5">
                            <button
                              onClick={() => void decide(l.id, 'approved')}
                              disabled={acting === l.id}
                              className="px-2.5 py-1 rounded-lg bg-green-600 text-white text-xs font-medium hover:bg-green-700 disabled:opacity-50"
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => void decide(l.id, 'rejected')}
                              disabled={acting === l.id}
                              className="px-2.5 py-1 rounded-lg bg-red-500 text-white text-xs font-medium hover:bg-red-600 disabled:opacity-50"
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
    </div>
  )
}
