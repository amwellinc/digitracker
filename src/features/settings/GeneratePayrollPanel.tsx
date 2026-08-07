import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import type { User } from '@/types'
import { fmtAmount, type PayrollRun } from './payrollShared'
import { PayrollRunForm } from './PayrollRunForm'
import { PayslipView } from './PayslipView'

interface Props {
  isManager: boolean
  users: User[]
}

export function GeneratePayrollPanel({ isManager, users }: Props) {
  const { user } = useAuth()
  const [runs, setRuns] = useState<PayrollRun[]>([])
  const [loading, setLoading] = useState(true)
  const [filterUser, setFilterUser] = useState('all')
  const [showForm, setShowForm] = useState(false)
  const [editingRun, setEditingRun] = useState<PayrollRun | null>(null)
  const [payslipRun, setPayslipRun] = useState<PayrollRun | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const fetchRuns = useCallback(async () => {
    if (!user) return
    setLoading(true)
    const q = supabase
      .from('payroll_runs')
      .select('*, user:users!payroll_runs_user_id_fkey(name,email)')
      .order('payment_date', { ascending: false })

    if (!isManager) q.eq('user_id', user.id)

    const { data } = await q
    setRuns((data as PayrollRun[]) ?? [])
    setLoading(false)
  }, [user, isManager])

  useEffect(() => { void fetchRuns() }, [fetchRuns])

  // Defense-in-depth: never render a run for a user outside the already
  // correctly-scoped `users` list, even if the server ever returns more
  // than it should. Super-Admin is unrestricted by design.
  const allowedUserIds = new Set<string>(users.map(u => u.id))
  if (user) allowedUserIds.add(user.id)
  const scopedRuns = user?.role === 'Super-Admin'
    ? runs
    : runs.filter(r => allowedUserIds.has(r.user_id))

  const visible = filterUser === 'all' ? scopedRuns : scopedRuns.filter(r => r.user_id === filterUser)

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this payroll record? This cannot be undone.')) return
    setDeletingId(id)
    setActionError(null)
    const { error } = await supabase.from('payroll_runs').delete().eq('id', id)
    setDeletingId(null)
    if (error) { setActionError(`Could not delete payroll record: ${error.message}`); return }
    void fetchRuns()
  }

  function openNew() { setEditingRun(null); setShowForm(true) }
  function openEdit(run: PayrollRun) { setEditingRun(run); setShowForm(true) }

  if (!user) return null

  return (
    <div>
      {actionError && (
        <div className="mb-4 px-4 py-3 rounded-lg text-sm font-medium bg-red-50 border border-red-200 text-red-700">
          {actionError}
        </div>
      )}

      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        {isManager && users.length > 0 ? (
          <select value={filterUser} onChange={e => setFilterUser(e.target.value)}
            className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-violet-400">
            <option value="all">All employees</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        ) : <div />}

        {isManager && (
          <button onClick={openNew}
            className="bg-violet-600 hover:bg-violet-700 text-white rounded-lg px-4 py-2 text-sm font-semibold transition-colors">
            + Generate Payroll
          </button>
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        {loading ? (
          <div className="py-12 text-center text-sm text-gray-400">Loading…</div>
        ) : visible.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">No payroll generated yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 whitespace-nowrap">Date</th>
                  {isManager && <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 whitespace-nowrap">Employee</th>}
                  <th className="text-right px-4 py-2.5 text-xs font-medium text-gray-500 whitespace-nowrap">Gross</th>
                  <th className="text-right px-4 py-2.5 text-xs font-medium text-gray-500 whitespace-nowrap">Net Pay</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {visible.map(r => (
                  <tr key={r.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap font-mono text-xs">
                      {new Date(r.payment_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </td>
                    {isManager && (
                      <td className="px-4 py-3 whitespace-nowrap">
                        <p className="text-gray-800 font-medium text-xs">{r.user?.name ?? '—'}</p>
                        <p className="text-gray-400 text-xs">{r.user?.email}</p>
                      </td>
                    )}
                    <td className="px-4 py-3 text-right whitespace-nowrap font-mono text-gray-600">
                      {fmtAmount(r.gross_salary, r.currency)}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap font-mono font-semibold text-gray-900">
                      {fmtAmount(r.net_pay, r.currency)}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-3">
                        <button onClick={() => setPayslipRun(r)} className="text-xs text-violet-600 hover:text-violet-800 font-medium">
                          Payslip
                        </button>
                        {isManager && (
                          <>
                            <button onClick={() => openEdit(r)} className="text-xs text-gray-400 hover:text-violet-600">
                              Edit
                            </button>
                            <button
                              onClick={() => void handleDelete(r.id)}
                              disabled={deletingId === r.id}
                              className="text-xs text-red-400 hover:text-red-600 disabled:opacity-40"
                            >
                              {deletingId === r.id ? '…' : 'Delete'}
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showForm && (
        <PayrollRunForm
          users={users}
          run={editingRun}
          defaultUserId={filterUser !== 'all' ? filterUser : undefined}
          onClose={() => setShowForm(false)}
          onSaved={fetchRuns}
        />
      )}

      {payslipRun && <PayslipView run={payslipRun} onClose={() => setPayslipRun(null)} />}
    </div>
  )
}
