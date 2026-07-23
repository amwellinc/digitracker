import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { PLAN_LABELS } from '@/lib/constants'

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

interface Currency {
  code: string
  symbol: string
  country: string
  flag: string
  is_active: boolean
  sort_order: number
}

interface PlanCurrencyPrice {
  id: string
  plan_id: string
  currency_code: string
  price_monthly: number
  price_annual: number
}

const PAID_PLAN_IDS = ['basic', 'business', 'professional'] as const

interface CurrencyForm {
  code: string
  symbol: string
  country: string
  flag: string
  prices: Record<string, { monthly: string; annual: string }>
}

function emptyCurrencyForm(): CurrencyForm {
  return {
    code: '', symbol: '', country: '', flag: '',
    prices: Object.fromEntries(PAID_PLAN_IDS.map(id => [id, { monthly: '', annual: '' }])),
  }
}

interface EditForm {
  name: string
  price_monthly: string
  price_annual: string
  max_seats: string
  features: string
  limitations: string
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

const PLAN_HEADER_BG: Record<string, string> = {
  free:         'bg-gray-50',
  basic:        'bg-blue-50',
  business:     'bg-violet-50',
  professional: 'bg-amber-50',
}

// Items prefixed with '-' are limitations; all others are features.
// Backward-compatible: existing unprefixed items are treated as features.
function parseItems(items: string[]) {
  const features: string[] = []
  const limitations: string[] = []
  for (const item of items) {
    const trimmed = item.trim()
    if (!trimmed) continue
    if (trimmed.startsWith('-')) {
      limitations.push(trimmed.slice(1).trim())
    } else {
      features.push(trimmed.startsWith('+') ? trimmed.slice(1).trim() : trimmed)
    }
  }
  return { features, limitations }
}

function serializeItems(featuresText: string, limitationsText: string): string[] {
  const f = featuresText.split('\n').map(s => s.trim()).filter(Boolean)
  const l = limitationsText.split('\n').map(s => s.trim()).filter(Boolean).map(s => `-${s}`)
  return [...f, ...l]
}

function fmtPrice(symbol: string, price: number) {
  if (price >= 1000) return `${symbol}${price.toLocaleString()}`
  return `${symbol}${price.toFixed(2)}`
}

// All plans include every feature — the only differentiators are seat count
// (max_seats, set above) and, for Free specifically, screenshot retention and
// document storage, both enforced in code rather than listed as a feature gate.
const DEFAULT_LIMITATIONS: Record<string, string> = {
  free: [
    'Screenshots kept for 7 days',
    'HR documents capped at 50MB per user',
  ].join('\n'),
  basic: '',
  business: '',
  professional: '',
}

export function PlansAndPricingTab() {
  const [plans, setPlans] = useState<PlanConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [editPlan, setEditPlan] = useState<PlanConfig | null>(null)
  const [editForm, setEditForm] = useState<EditForm | null>(null)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [activeTab, setActiveTab] = useState<'features' | 'limitations'>('features')

  const [currencies, setCurrencies] = useState<Currency[]>([])
  const [prices, setPrices] = useState<PlanCurrencyPrice[]>([])
  const [currenciesLoading, setCurrenciesLoading] = useState(true)
  const [editCurrency, setEditCurrency] = useState<Currency | 'new' | null>(null)
  const [currencyForm, setCurrencyForm] = useState<CurrencyForm>(emptyCurrencyForm())
  const [savingCurrency, setSavingCurrency] = useState(false)
  const [currencyMsg, setCurrencyMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [deletingCurrency, setDeletingCurrency] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('plan_configs').select('*').order('sort_order')
    setPlans((data ?? []) as PlanConfig[])
    setLoading(false)
  }, [])

  const loadCurrencies = useCallback(async () => {
    setCurrenciesLoading(true)
    const [{ data: curData }, { data: priceData }] = await Promise.all([
      supabase.from('currencies').select('*').order('sort_order'),
      supabase.from('plan_currency_pricing').select('*'),
    ])
    setCurrencies((curData ?? []) as Currency[])
    setPrices((priceData ?? []) as PlanCurrencyPrice[])
    setCurrenciesLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])
  useEffect(() => { void loadCurrencies() }, [loadCurrencies])

  function priceFor(planId: string, currencyCode: string) {
    return prices.find(p => p.plan_id === planId && p.currency_code === currencyCode)
  }

  function openAddCurrency() {
    setCurrencyForm(emptyCurrencyForm())
    setEditCurrency('new')
    setCurrencyMsg(null)
  }

  function openEditCurrency(c: Currency) {
    setCurrencyForm({
      code: c.code, symbol: c.symbol, country: c.country, flag: c.flag,
      prices: Object.fromEntries(PAID_PLAN_IDS.map(id => {
        const p = priceFor(id, c.code)
        return [id, { monthly: p ? String(p.price_monthly) : '', annual: p ? String(p.price_annual) : '' }]
      })),
    })
    setEditCurrency(c)
    setCurrencyMsg(null)
  }

  async function handleSaveCurrency(e: React.FormEvent) {
    e.preventDefault()
    setSavingCurrency(true)
    setCurrencyMsg(null)

    const isNew = editCurrency === 'new'
    const code = currencyForm.code.trim().toUpperCase()
    if (!code) { setSavingCurrency(false); setCurrencyMsg({ type: 'error', text: 'Currency code is required.' }); return }

    if (isNew) {
      const maxSort = currencies.reduce((m, c) => Math.max(m, c.sort_order), -1)
      const { error } = await supabase.from('currencies').insert({
        code, symbol: currencyForm.symbol.trim(), country: currencyForm.country.trim(),
        flag: currencyForm.flag.trim(), sort_order: maxSort + 1,
      })
      if (error) { setSavingCurrency(false); setCurrencyMsg({ type: 'error', text: error.message }); return }
    } else {
      const { error } = await supabase.from('currencies').update({
        symbol: currencyForm.symbol.trim(), country: currencyForm.country.trim(), flag: currencyForm.flag.trim(),
      }).eq('code', code)
      if (error) { setSavingCurrency(false); setCurrencyMsg({ type: 'error', text: error.message }); return }
    }

    const priceRows = PAID_PLAN_IDS.map(id => ({
      plan_id: id,
      currency_code: code,
      price_monthly: parseFloat(currencyForm.prices[id].monthly) || 0,
      price_annual: parseFloat(currencyForm.prices[id].annual) || 0,
      updated_at: new Date().toISOString(),
    }))
    const { error: priceError } = await supabase
      .from('plan_currency_pricing')
      .upsert(priceRows, { onConflict: 'plan_id,currency_code' })

    setSavingCurrency(false)
    if (priceError) { setCurrencyMsg({ type: 'error', text: priceError.message }); return }
    setCurrencyMsg({ type: 'success', text: isNew ? 'Currency added.' : 'Currency updated.' })
    void loadCurrencies()
    setTimeout(() => { setEditCurrency(null); setCurrencyMsg(null) }, 1200)
  }

  async function handleDeleteCurrency(code: string) {
    if (!window.confirm(`Remove ${code} and all its pricing? This cannot be undone.`)) return
    setDeletingCurrency(code)
    const { error } = await supabase.from('currencies').delete().eq('code', code)
    setDeletingCurrency(null)
    if (error) { alert(error.message); return }
    void loadCurrencies()
  }

  function openEdit(p: PlanConfig) {
    const { features, limitations } = parseItems(p.features)
    setEditForm({
      name: p.name,
      price_monthly: String(p.price_monthly),
      price_annual: String(p.price_annual),
      max_seats: String(p.max_seats),
      features: features.join('\n'),
      limitations: limitations.length > 0
        ? limitations.join('\n')
        : (DEFAULT_LIMITATIONS[p.id] ?? ''),
      is_active: p.is_active,
    })
    setEditPlan(p)
    setActiveTab('features')
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
        features: serializeItems(editForm.features, editForm.limitations),
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
          Configure subscription tiers, pricing, features, and limitations. Click "Edit Plan" to modify any plan.
        </p>
      </div>

      {/* Plan Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {plans.map(plan => {
          const { features, limitations } = parseItems(plan.features)
          return (
            <div
              key={plan.id}
              className={`relative bg-white rounded-xl border-2 flex flex-col overflow-hidden ${PLAN_ACCENT[plan.id]} ${!plan.is_active ? 'opacity-50' : ''}`}
            >
              {/* Card Header */}
              <div className={`${PLAN_HEADER_BG[plan.id]} px-5 pt-5 pb-4 border-b border-gray-100`}>
                <div className="flex items-start justify-between mb-2">
                  <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${PLAN_BADGE[plan.id]}`}>
                    {PLAN_LABELS[plan.id] ?? plan.id}
                  </span>
                  {!plan.is_active && (
                    <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Inactive</span>
                  )}
                </div>
                <h3 className="font-bold text-gray-900 text-lg">{PLAN_LABELS[plan.id] ?? plan.name}</h3>
                <div className="mt-2 space-y-0.5">
                  <div className="flex items-end gap-1">
                    <span className="text-2xl font-extrabold text-gray-900">${plan.price_monthly.toFixed(2)}</span>
                    <span className="text-sm text-gray-400 mb-0.5">/mo</span>
                  </div>
                  {plan.price_annual > 0 && (
                    <p className="text-xs text-gray-500">${plan.price_annual.toFixed(2)}/yr ({Math.round((1 - plan.price_annual / (plan.price_monthly * 12)) * 100)}% off)</p>
                  )}
                  <p className="text-xs text-gray-500 font-medium">Up to {plan.max_seats.toLocaleString()} seats</p>
                </div>
              </div>

              {/* Features + Limitations */}
              <div className="px-5 py-4 flex-1 space-y-3">
                {features.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Included</p>
                    <ul className="space-y-1.5">
                      {features.map((f, i) => (
                        <li key={i} className="flex items-start gap-2 text-xs text-gray-700">
                          <span className="text-emerald-500 mt-0.5 flex-shrink-0 font-bold">✓</span>
                          {f}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {limitations.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Limitations</p>
                    <ul className="space-y-1.5">
                      {limitations.map((l, i) => (
                        <li key={i} className="flex items-start gap-2 text-xs text-gray-400">
                          <span className="text-red-400 mt-0.5 flex-shrink-0 font-bold">✗</span>
                          {l}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {features.length === 0 && limitations.length === 0 && (
                  <p className="text-xs text-gray-400 italic">No features configured yet. Click Edit Plan to add.</p>
                )}
              </div>

              {/* Edit Button */}
              <div className="px-5 pb-5">
                <button
                  onClick={() => openEdit(plan)}
                  className="w-full border border-violet-200 text-violet-600 hover:bg-violet-50 rounded-lg py-2 text-sm font-medium transition-colors"
                >
                  Edit Plan
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <div className="mt-5 bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
        <strong>Note:</strong> Price changes here update the display and billing records. Connect a Stripe integration to trigger live payment changes automatically.
      </div>

      {/* Multi-Currency Pricing Table */}
      <div className="mt-8">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-base font-semibold text-gray-900">Multi-Currency Pricing</h2>
          <button
            onClick={openAddCurrency}
            className="flex items-center gap-1.5 bg-violet-600 text-white rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-violet-700 transition-colors"
          >
            <span className="text-sm leading-none">+</span> Add Currency
          </button>
        </div>
        <p className="text-sm text-gray-500 mb-4">
          Prices by country and currency. Click a row to edit its pricing, or remove it entirely.
        </p>
        {currenciesLoading ? (
          <div className="flex items-center justify-center h-24 text-sm text-gray-400">Loading currencies…</div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">Country</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">Currency</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600 whitespace-nowrap">
                    <span className="text-blue-600">Standard</span><span className="text-gray-400 text-xs ml-1">/mo</span>
                  </th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600 whitespace-nowrap">
                    <span className="text-violet-600">Business</span><span className="text-gray-400 text-xs ml-1">/mo</span>
                  </th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600 whitespace-nowrap">
                    <span className="text-amber-600">Professional</span><span className="text-gray-400 text-xs ml-1">/mo</span>
                  </th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {currencies.length === 0 && (
                  <tr><td colSpan={6} className="text-center py-8 text-gray-400">No currencies yet. Click "Add Currency" to create one.</td></tr>
                )}
                {currencies.map(c => {
                  const basic = priceFor('basic', c.code)
                  const business = priceFor('business', c.code)
                  const professional = priceFor('professional', c.code)
                  return (
                    <tr
                      key={c.code}
                      onClick={() => openEditCurrency(c)}
                      className={`hover:bg-gray-50 cursor-pointer ${c.code === 'USD' ? 'bg-gray-50 font-semibold' : ''}`}
                    >
                      <td className="px-4 py-2.5 text-gray-800 whitespace-nowrap">
                        <span className="mr-2">{c.flag}</span>{c.country}
                        {c.code === 'USD' && <span className="ml-2 text-xs bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded">Base</span>}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-gray-500 text-xs">{c.code}</td>
                      <td className="px-4 py-2.5 text-right text-blue-700 whitespace-nowrap">{basic ? fmtPrice(c.symbol, basic.price_monthly) : '—'}</td>
                      <td className="px-4 py-2.5 text-right text-violet-700 whitespace-nowrap">{business ? fmtPrice(c.symbol, business.price_monthly) : '—'}</td>
                      <td className="px-4 py-2.5 text-right text-amber-700 whitespace-nowrap">{professional ? fmtPrice(c.symbol, professional.price_monthly) : '—'}</td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          onClick={e => { e.stopPropagation(); void handleDeleteCurrency(c.code) }}
                          disabled={deletingCurrency === c.code}
                          className="text-xs text-red-400 hover:text-red-600 disabled:opacity-40"
                        >
                          {deletingCurrency === c.code ? '…' : 'Delete'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-gray-400 mt-2">
          Free plan: always $0 / free across all currencies. Rates shown here are what sub-accounts are actually billed — confirm against your payment processor before publishing changes.
        </p>
      </div>

      {/* Edit Modal */}
      {editPlan && editForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">

            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
              <div>
                <h3 className="font-semibold text-gray-900">
                  Edit Plan —{' '}
                  <span className={PLAN_BADGE[editPlan.id].split(' ')[1]}>
                    {PLAN_LABELS[editPlan.id] ?? editPlan.id}
                  </span>
                </h3>
                <p className="text-xs text-gray-400 mt-0.5">Changes apply immediately to all new sign-ups.</p>
              </div>
              <button
                onClick={() => { setEditPlan(null); setEditForm(null) }}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none ml-4"
              >
                &times;
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleSave} className="overflow-y-auto flex-1 px-6 py-4 space-y-4">

              {/* Pricing & Seats */}
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Pricing & Seats</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Monthly Price ($)</label>
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
                    <label className="block text-xs font-medium text-gray-700 mb-1">Annual Price ($)</label>
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
                <div className="mt-3">
                  <label className="block text-xs font-medium text-gray-700 mb-1">Max Seats</label>
                  <input
                    type="number"
                    min={1}
                    value={editForm.max_seats}
                    onChange={e => setEditForm(f => f ? { ...f, max_seats: e.target.value } : f)}
                    className="input"
                  />
                </div>
              </div>

              {/* Features & Limitations Tabs */}
              <div>
                <div className="flex gap-1 mb-3 bg-gray-100 rounded-lg p-1">
                  <button
                    type="button"
                    onClick={() => setActiveTab('features')}
                    className={`flex-1 text-xs font-medium py-1.5 rounded-md transition-colors ${
                      activeTab === 'features'
                        ? 'bg-white text-emerald-700 shadow-sm'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    ✓ Features Included
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('limitations')}
                    className={`flex-1 text-xs font-medium py-1.5 rounded-md transition-colors ${
                      activeTab === 'limitations'
                        ? 'bg-white text-red-600 shadow-sm'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    ✗ Limitations
                  </button>
                </div>

                {activeTab === 'features' && (
                  <div>
                    <p className="text-xs text-gray-500 mb-2">
                      List what this plan <strong>includes</strong>. One item per line. Add new items at the bottom.
                    </p>
                    <textarea
                      rows={7}
                      value={editForm.features}
                      onChange={e => setEditForm(f => f ? { ...f, features: e.target.value } : f)}
                      className="input resize-none font-mono text-xs"
                      placeholder={'Clock-in & Clock-out tracking\nTime log reports\nPublic holiday management\nLeave management\nScreen capture'}
                    />
                    <p className="text-xs text-gray-400 mt-1">
                      {editForm.features.split('\n').filter(s => s.trim()).length} feature{editForm.features.split('\n').filter(s => s.trim()).length !== 1 ? 's' : ''}
                    </p>
                  </div>
                )}

                {activeTab === 'limitations' && (
                  <div>
                    <p className="text-xs text-gray-500 mb-2">
                      List what this plan <strong>does not include</strong> or restricts. One item per line.
                    </p>
                    <textarea
                      rows={7}
                      value={editForm.limitations}
                      onChange={e => setEditForm(f => f ? { ...f, limitations: e.target.value } : f)}
                      className="input resize-none font-mono text-xs"
                      placeholder={'Up to 5 users only\nNo screen capture\nNo KPI tracking\nNo priority support'}
                    />
                    <p className="text-xs text-gray-400 mt-1">
                      {editForm.limitations.split('\n').filter(s => s.trim()).length} limitation{editForm.limitations.split('\n').filter(s => s.trim()).length !== 1 ? 's' : ''}
                    </p>
                  </div>
                )}
              </div>

              {/* Display Name */}
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Display</p>
                <label className="block text-xs font-medium text-gray-700 mb-1">Plan Display Name</label>
                <input
                  value={editForm.name}
                  onChange={e => setEditForm(f => f ? { ...f, name: e.target.value } : f)}
                  className="input"
                  placeholder="e.g. Standard"
                />
                <p className="text-xs text-gray-400 mt-1">
                  Overridden by system labels — this updates the database record only.
                </p>
              </div>

              {/* Active toggle */}
              <div className="flex items-center gap-3 py-1">
                <input
                  type="checkbox"
                  id="is_active"
                  checked={editForm.is_active}
                  onChange={e => setEditForm(f => f ? { ...f, is_active: e.target.checked } : f)}
                  className="w-4 h-4 accent-violet-600"
                />
                <label htmlFor="is_active" className="text-sm text-gray-700">Plan is active (visible to users)</label>
              </div>

              {msg && (
                <p className={`text-sm ${msg.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
                  {msg.text}
                </p>
              )}

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => { setEditPlan(null); setEditForm(null) }}
                  className="btn-ghost"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="btn-primary"
                >
                  {saving ? 'Saving…' : 'Save Plan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add/Edit Currency Modal */}
      {editCurrency && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
              <h3 className="font-semibold text-gray-900">
                {editCurrency === 'new' ? 'Add Currency' : `Edit — ${editCurrency.country}`}
              </h3>
              <button
                onClick={() => setEditCurrency(null)}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleSaveCurrency} className="overflow-y-auto flex-1 px-6 py-4 space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Code</label>
                  <input
                    value={currencyForm.code}
                    onChange={e => setCurrencyForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                    placeholder="USD"
                    maxLength={6}
                    required
                    readOnly={editCurrency !== 'new'}
                    className={`input font-mono uppercase ${editCurrency !== 'new' ? 'bg-gray-50 text-gray-400' : ''}`}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Symbol</label>
                  <input
                    value={currencyForm.symbol}
                    onChange={e => setCurrencyForm(f => ({ ...f, symbol: e.target.value }))}
                    placeholder="$"
                    required
                    className="input"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Flag</label>
                  <input
                    value={currencyForm.flag}
                    onChange={e => setCurrencyForm(f => ({ ...f, flag: e.target.value }))}
                    placeholder="🇺🇸"
                    className="input"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Country</label>
                <input
                  value={currencyForm.country}
                  onChange={e => setCurrencyForm(f => ({ ...f, country: e.target.value }))}
                  placeholder="United States"
                  required
                  className="input"
                />
              </div>

              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Pricing per Plan</p>
                <div className="space-y-2">
                  {PAID_PLAN_IDS.map(id => (
                    <div key={id} className="grid grid-cols-3 gap-2 items-center">
                      <span className="text-xs font-medium text-gray-600">{PLAN_LABELS[id] ?? id}</span>
                      <input
                        type="number" min={0} step={0.01}
                        value={currencyForm.prices[id].monthly}
                        onChange={e => setCurrencyForm(f => ({
                          ...f, prices: { ...f.prices, [id]: { ...f.prices[id], monthly: e.target.value } },
                        }))}
                        placeholder="Monthly"
                        className="input text-sm"
                      />
                      <input
                        type="number" min={0} step={0.01}
                        value={currencyForm.prices[id].annual}
                        onChange={e => setCurrencyForm(f => ({
                          ...f, prices: { ...f.prices, [id]: { ...f.prices[id], annual: e.target.value } },
                        }))}
                        placeholder="Annual"
                        className="input text-sm"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {currencyMsg && (
                <p className={`text-sm ${currencyMsg.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
                  {currencyMsg.text}
                </p>
              )}

              <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
                <button type="button" onClick={() => setEditCurrency(null)} className="btn-ghost">Cancel</button>
                <button type="submit" disabled={savingCurrency} className="btn-primary">
                  {savingCurrency ? 'Saving…' : editCurrency === 'new' ? 'Add Currency' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
