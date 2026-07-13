import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import type { LeaveRequest } from '@/types'

const MEDICAL_DAYS = 14

function diffDays(start: string, end: string) {
  const ms = new Date(end).getTime() - new Date(start).getTime()
  return Math.max(1, Math.round(ms / 86400000) + 1)
}

function fmtDate(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })
}

const STATUS_STYLE: Record<string, string> = {
  pending:  'bg-amber-50 text-amber-700',
  approved: 'bg-green-50 text-green-700',
  rejected: 'bg-red-50 text-red-700',
}

interface BalanceCardProps {
  label: string
  icon: string
  used: number
  total: number
  unit: string
  color: string
}

function BalanceCard({ label, icon, used, total, unit, color }: BalanceCardProps) {
  const left = Math.max(0, total - used)
  const pct  = total > 0 ? Math.min(100, (used / total) * 100) : 0
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5 flex-1 min-w-0">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xl">{icon}</span>
        <span className="text-sm font-medium text-gray-700">{label}</span>
      </div>
      <p className={`text-3xl font-bold ${color}`}>{left}</p>
      <p className="text-xs text-gray-400 mb-3">{unit} remaining</p>
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color.replace('text-', 'bg-')}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs text-gray-400 mt-1.5">{used}/{total} {unit} used</p>
    </div>
  )
}

interface Props {
  onRequest: () => void
  refreshTick: number
}

export function MyLeaveTab({ onRequest, refreshTick }: Props) {
  const { user } = useAuth()
  const [leaves, setLeaves] = useState<LeaveRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [cancelling, setCancelling] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!user) return
    const year = new Date().getFullYear()
    const { data } = await supabase
      .from('leave_requests')
      .select('*')
      .eq('user_id', user.id)
      .gte('start_date', `${year}-01-01`)
      .order('created_at', { ascending: false })
    setLeaves((data ?? []) as LeaveRequest[])
    setLoading(false)
  }, [user])

  useEffect(() => { void load() }, [load, refreshTick])

  // Realtime updates
  useEffect(() => {
    if (!user) return
    const ch = supabase
      .channel('my-leave-realtime')
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'leave_requests',
        filter: `user_id=eq.${user.id}`,
      }, () => void load())
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [user, load])

  async function cancelLeave(id: string) {
    setCancelling(id)
    await supabase.from('leave_requests').delete().eq('id', id)
    setCancelling(null)
  }

  const approved = leaves.filter(l => l.status === 'approved')

  const annualUsed   = approved.filter(l => l.type === 'Annual').reduce((s, l) => s + diffDays(l.start_date, l.end_date), 0)
  const medicalUsed  = approved.filter(l => l.type === 'Medical').reduce((s, l) => s + diffDays(l.start_date, l.end_date), 0)
  const timeOffUsed  = approved.filter(l => l.type === 'Time-off').reduce((s, l) => s + (l.hours ?? 0), 0)
  const annualTotal  = user?.annual_leave ?? 14
  const timeOffTotal = (user?.time_off ?? 5) * 8

  if (loading) return <div className="flex justify-center py-16"><div className="w-6 h-6 border-4 border-violet-600 border-t-transparent rounded-full animate-spin" /></div>

  return (
    <div className="space-y-5">
      {/* Balance cards */}
      <div className="flex gap-4">
        <BalanceCard label="Annual Leave" icon="🌴" used={annualUsed}  total={annualTotal}  unit="days"  color="text-violet-600" />
        <BalanceCard label="Medical Leave" icon="🏥" used={medicalUsed} total={MEDICAL_DAYS} unit="days"  color="text-blue-600" />
        <BalanceCard label="Time-off"     icon="⏱" used={timeOffUsed} total={timeOffTotal} unit="hours" color="text-green-600" />
      </div>

      {/* Leave history */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">Leave History</h3>
          <button
            onClick={onRequest}
            className="bg-violet-600 text-white text-sm font-medium px-4 py-1.5 rounded-lg hover:bg-violet-700 transition-colors"
          >
            + Request Leave
          </button>
        </div>

        {leaves.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <p className="text-4xl mb-2">📋</p>
            <p className="text-sm">No leave requests this year</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  {['Type', 'Date(s)', 'Duration', 'Reason', 'Status', 'Remarks', ''].map(h => (
                    <th key={h} className="px-5 py-3 text-left font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {leaves.map(l => (
                  <tr key={l.id} className="hover:bg-gray-50">
                    <td className="px-5 py-3 font-medium text-gray-900">{l.type}</td>
                    <td className="px-5 py-3 text-gray-600">
                      {l.type === 'Time-off'
                        ? fmtDate(l.start_date)
                        : l.start_date === l.end_date
                        ? fmtDate(l.start_date)
                        : `${fmtDate(l.start_date)} – ${fmtDate(l.end_date)}`}
                    </td>
                    <td className="px-5 py-3 text-gray-600">
                      {l.type === 'Time-off' ? `${l.hours}h` : `${diffDays(l.start_date, l.end_date)} day${diffDays(l.start_date, l.end_date) === 1 ? '' : 's'}`}
                    </td>
                    <td className="px-5 py-3 text-gray-600 max-w-xs truncate">{l.reason}</td>
                    <td className="px-5 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_STYLE[l.status]}`}>
                        {l.status}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-xs max-w-[200px]">
                      {l.status === 'rejected' && l.remarks ? (
                        <span className="text-red-600 italic" title={l.remarks}>
                          {l.remarks.length > 80 ? l.remarks.slice(0, 80) + '…' : l.remarks}
                        </span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      {l.status === 'pending' && (
                        <button
                          onClick={() => void cancelLeave(l.id)}
                          disabled={cancelling === l.id}
                          className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
                        >
                          {cancelling === l.id ? 'Cancelling…' : 'Cancel'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
