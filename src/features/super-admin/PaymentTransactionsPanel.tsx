import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

interface Transaction {
  id: string
  sub_account: string | null
  stripe_event_id: string
  stripe_customer_id: string | null
  stripe_invoice_id: string | null
  event_type: string
  status: 'succeeded' | 'failed' | 'pending' | 'refunded'
  amount: number | null
  currency: string | null
  failure_reason: string | null
  created_at: string
}

type StatusFilter = 'all' | Transaction['status']

const STATUS_STYLES: Record<Transaction['status'], string> = {
  succeeded: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  failed:    'bg-red-50 text-red-700 border-red-200',
  pending:   'bg-amber-50 text-amber-700 border-amber-200',
  refunded:  'bg-gray-100 text-gray-600 border-gray-200',
}

function formatAmount(amount: number | null, currency: string | null): string {
  if (amount === null) return '—'
  return `${(currency ?? 'usd').toUpperCase()} ${amount.toFixed(2)}`
}

function formatEventType(type: string): string {
  return type.replace(/[._]/g, ' ')
}

export function PaymentTransactionsPanel() {
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .from('payment_transactions')
      .select('id, sub_account, stripe_event_id, stripe_customer_id, stripe_invoice_id, event_type, status, amount, currency, failure_reason, created_at')
      .order('created_at', { ascending: false })
      .limit(200)

    if (statusFilter !== 'all') query = query.eq('status', statusFilter)

    const { data } = await query
    setTransactions((data as Transaction[] | null) ?? [])
    setLoading(false)
  }, [statusFilter])

  useEffect(() => { void load() }, [load])

  const filtered = transactions.filter(t =>
    !search || (t.sub_account ?? '').toLowerCase().includes(search.toLowerCase())
  )

  const last30 = transactions.filter(t => Date.now() - new Date(t.created_at).getTime() < 30 * 24 * 60 * 60 * 1000)
  const revenue30d = last30
    .filter(t => t.status === 'succeeded' && t.amount !== null)
    .reduce((sum, t) => sum + (t.amount ?? 0), 0)
  const failedCount30d = last30.filter(t => t.status === 'failed').length
  const totalEvents30d = last30.length

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-sm text-blue-800">
        This is a read-only audit trail written automatically by the Stripe webhook — it reflects exactly
        what Stripe reported, so it isn't editable here. To issue a refund or retry a charge, do it in the{' '}
        <a href="https://dashboard.stripe.com" target="_blank" rel="noreferrer" className="underline font-medium">
          Stripe Dashboard
        </a>{' '}
        — the webhook will record the result automatically.
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Revenue — Last 30 Days</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">${revenue30d.toFixed(2)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Failed Payments — 30d</p>
          <p className={`text-2xl font-bold mt-1 ${failedCount30d > 0 ? 'text-red-600' : 'text-gray-900'}`}>{failedCount30d}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Total Events — 30d</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{totalEvents30d}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as StatusFilter)}
          className="input w-40 text-sm"
        >
          <option value="all">All statuses</option>
          <option value="succeeded">Succeeded</option>
          <option value="failed">Failed</option>
          <option value="pending">Pending</option>
          <option value="refunded">Refunded</option>
        </select>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Filter by sub-account code…"
          className="input w-56 text-sm"
        />
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-sm text-gray-400">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-sm text-gray-400">
            No transactions yet — they'll appear here once Stripe sends webhook events.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">Date</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">Sub-Account</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">Event</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">Status</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600 whitespace-nowrap">Amount</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">Note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(t => (
                <tr key={t.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{new Date(t.created_at).toLocaleString()}</td>
                  <td className="px-4 py-3 font-medium text-gray-800 whitespace-nowrap">{t.sub_account ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-600 capitalize whitespace-nowrap">{formatEventType(t.event_type)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block text-xs font-semibold px-2.5 py-0.5 rounded-full border capitalize ${STATUS_STYLES[t.status]}`}>
                      {t.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-gray-800 whitespace-nowrap">{formatAmount(t.amount, t.currency)}</td>
                  <td className="px-4 py-3 text-gray-500 max-w-xs truncate">{t.failure_reason ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
