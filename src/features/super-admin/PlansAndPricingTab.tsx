import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { PLAN_LABELS, PLAN_CURRENCIES } from '@/lib/constants'

interface PlanConfig {
  id: string
  name: string
  price_monthly: number
  price_annual: number
  max_seats: number
  features: string[]
  is_active: boolean
  sort_order: number
}

interface EditForm {
  name: string
  price_monthly: string
  price_annual: string
  max_seats: string
  features: string
  is_active: boolean
}

const PLAN_ACCENT: Record<string, string> = {
  free:         'border-gray-200',
  basic:        'border-blue-300',
  business:     'border-violet-400',
  professional: 'border-amber-400',
}

const PLAN_BADGE: Record<string, string> = {
  free:         'bg-gray-100 text-gray-600',
  basic:        'bg-blue-100 text-blue-700',
  business:     'bg-violet-100 text-violet-700',
  professional: 'bg-amber-100 text-amber-700',
}

function fmtPrice(symbol: string, price: number) {
  if (price >= 1000) return `${symbol}${price.toLocaleString()}`
  return `${symbol}${price.toFixed(2)}`
}

export function PlansAndPricingTab() {
  const [plans, setPlans] = useState<PlanConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [editPlan, setEditPlan] = useState<PlanConfig | null>(null)
  const [editForm, setEditForm] = useState<EditForm | null>(null)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('plan_configs').select('*').order('sort_order')
    setPlans((data ?? []) as PlanConfig[])
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  function openEdit(p: PlanConfig) {
    setEditForm({
      name: p.name,
      price_monthly: String(p.price_monthly),
      price_annual: String(p.price_annual),
      max_seats: String(p.max_seats),
      features: p.features.join('\n'),
      is_active: p.is_active,
    })
    setEditPlan(p)
    setMsg(null)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!editPlan || !editForm) return
    setSaving(true)
    setMsg(null)

    const { error } = await supabase
      .from('plan_configs')
      .update({
        name: editForm.name.trim(),
        price_monthly: parseFloat(editForm.price_monthly) || 0,
        price_annual: parseFloat(editForm.price_annual) || 0,
        max_seats: parseInt(editForm.max_seats) || 1,
        features: editForm.features.split('\n').map(f => f.trim()).filter(Boolean),
        is_active: editForm.is_active,
        updated_at: new Date().toISOString(),
      })
      .eq('id', editPlan.id)

    setSaving(false)
    if (error) { setMsg({ type: 'error', text: error.message }); return }
    setMsg({ type: 'success', text: 'Plan updated.' })
    void load()
    setTimeout(() => { setEditPlan(null); setEditForm(null); setMsg(null) }, 1500)
  }

  if (loading) {
    return <div className="flex items-center justify-center h-40 text-sm text-gray-400">Loading plans…</div>
  }

  return (
    <div>
      <div className="mb-5">
        <h2 className="text-base font-semibold text-gray-900">Plans & Pricing</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Configure subscription tiers, pricing, and feature sets.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {plans.map(plan => (
          <div
            key={plan.id}
            className={`relative bg-white rounded-xl border-2 p-5 flex flex-col ${PLAN_ACCENT[plan.id]} ${!plan.is_active ? 'opacity-50' : ''}`}
          >
            <div className="flex items-start justify-between mb-3">
              <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${PLAN_BADGE[plan.id]}`}>
                {PLAN_LABELS[plan.id] ?? plan.id}
              </span>
              {!plan.is_active && (
                <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Inactive</span>
              )}
            </div>

            <h3 className="font-bold text-gray-900 text-lg">{plan.name}</h3>

            <div className="mt-2 mb-4 space-y-1">
              <div className="flex items-end gap-1">
                <span className="text-2xl font-extrabold text-gray-900">${plan.price_monthly.toFixed(2)}</span>
                <span className="text-sm text-gray-400 mb-0.5">/mo</span>
              </div>
              {plan.price_annual > 0 && (
                <p className="text-xs text-gray-500">${plan.price_annual.toFixed(2)}/yr ({Math.round((1 - plan.price_annual / (plan.price_monthly * 12)) * 100)}% off)</p>
              )}
              <p className="text-xs text-gray-500">Up to {plan.max_seats.toLocaleString()} seats</p>
            </div>

            <ul className="space-y-1.5 flex-1 mb-4">
              {plan.features.map((f, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-gray-600">
                  <span className="text-emerald-500 mt-0.5 flex-shrink-0">✓</span>
                  {f}
                </li>
              ))}
            </ul>

            <button
              onClick={() => openEdit(plan)}
              className="w-full border border-violet-200 text-violet-600 hover:bg-violet-50 rounded-lg py-2 text-sm font-medium transition-colors"
            >
              Edit Plan
            </button>
          </div>
        ))}
      </div>

      <div className="mt-5 bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
        <strong>Note:</strong> Price changes here update the display and billing records. Connect a Stripe integration to trigger live payment changes automatically.
      </div>

      {/* Multi-Currency Pricing Table */}
      <div className="mt-8">
        <h2 className="text-base font-semibold text-gray-900 mb-1">Multi-Currency Pricing</h2>
        <p className="text-sm text-gray-500 mb-4">
          Reference prices by country and currency. USD is the master rate; local currency amounts are indicative.
        </p>
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Country</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Currency</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">
                  <span className="text-blue-600">Standard</span><span className="text-gray-400 text-xs ml-1">/mo</span>
                </th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">
                  <span className="text-violet-600">Business</span><span className="text-gray-400 text-xs ml-1">/mo</span>
                </th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">
                  <span className="text-amber-600">Professional</span><span className="text-gray-400 text-xs ml-1">/mo</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {PLAN_CURRENCIES.map(c => (
                <tr key={c.currency} className={`hover:bg-gray-50 ${c.currency === 'USD' ? 'bg-gray-50 font-semibold' : ''}`}>
                  <td className="px-4 py-2.5 text-gray-800">
                    <span className="mr-2">{c.flag}</span>{c.country}
                    {c.currency === 'USD' && <span className="ml-2 text-xs bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded">Base</span>}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-gray-500 text-xs">{c.currency}</td>
                  <td className="px-4 py-2.5 text-right text-blue-700">{fmtPrice(c.symbol, c.prices.basic)}</td>
                  <td className="px-4 py-2.5 text-right text-violet-700">{fmtPrice(c.symbol, c.prices.business)}</td>
                  <td className="px-4 py-2.5 text-right text-amber-700">{fmtPrice(c.symbol, c.prices.professional)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-400 mt-2">
          Free plan: always $0 / free across all currencies. Local currency rates are approximate and should be confirmed with your payment processor.
        </p>
      </div>

      {/* Edit Modal */}
      {editPlan && editForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900">
                Edit Plan — <span className={PLAN_BADGE[editPlan.id].split(' ')[1]}>{PLAN_LABELS[editPlan.id] ?? editPlan.id}</span>
              </h3>
              <button onClick={() => { setEditPlan(null); setEditForm(null) }} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
            </div>
            <form onSubmit={handleSave} className="px-6 py-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Plan Display Name</label>
                <input
                  value={editForm.name}
                  onChange={e => setEditForm(f => f ? { ...f, name: e.target.value } : f)}
                  className="input"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Monthly Price ($)</label>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={editForm.price_monthly}
                    onChange={e => setEditForm(f => f ? { ...f, price_monthly: e.target.value } : f)}
                    className="input"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Annual Price ($)</label>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={editForm.price_annual}
                    onChange={e => setEditForm(f => f ? { ...f, price_annual: e.target.value } : f)}
                    className="input"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Max Seats</label>
                <input
                  type="number"
                  min={1}
                  value={editForm.max_seats}
                  onChange={e => setEditForm(f => f ? { ...f, max_seats: e.target.value } : f)}
                  className="input"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Features (one per line)</label>
                <textarea
                  rows={6}
                  value={editForm.features}
                  onChange={e => setEditForm(f => f ? { ...f, features: e.target.value } : f)}
                  className="input resize-none font-mono text-xs"
                  placeholder="Feature 1&#10;Feature 2&#10;Feature 3"
                />
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="is_active"
                  checked={editForm.is_active}
                  onChange={e => setEditForm(f => f ? { ...f, is_active: e.target.checked } : f)}
                  className="w-4 h-4 accent-violet-600"
                />
                <label htmlFor="is_active" className="text-sm text-gray-700">Plan is active (visible to users)</label>
              </div>
              {msg && <p className={`text-sm ${msg.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>{msg.text}</p>}
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => { setEditPlan(null); setEditForm(null) }} className="btn-ghost">Cancel</button>
                <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving…' : 'Save Plan'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
