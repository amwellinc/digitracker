import { useState, useEffect, useCallback, useMemo } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'

interface PlanConfig {
  id: 'free' | 'basic' | 'business' | 'professional'
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
  flag: string
  is_active: boolean
  sort_order: number
}

interface PlanCurrencyPrice {
  plan_id: string
  currency_code: string
  price_monthly: number
  price_annual: number
}

const POPULAR_PLAN_ID = 'business'
type BillingCycle = 'monthly' | 'annual'
type Step = 'plan' | 'review'

interface FormState {
  companyName: string
  adminName: string
  adminEmail: string
  password: string
}

export function SubscribePage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const [plans, setPlans] = useState<PlanConfig[]>([])
  const [currencies, setCurrencies] = useState<Currency[]>([])
  const [prices, setPrices] = useState<PlanCurrencyPrice[]>([])
  const [trialDays, setTrialDays] = useState(0)
  const [loading, setLoading] = useState(true)

  const [step, setStep] = useState<Step>('plan')
  const [cycle, setCycle] = useState<BillingCycle>('monthly')
  const [currencyCode, setCurrencyCode] = useState('USD')
  const [selectedPlan, setSelectedPlan] = useState<PlanConfig['id']>('business')
  const [form, setForm] = useState<FormState>({ companyName: '', adminName: '', adminEmail: '', password: '' })
  const [showPass, setShowPass] = useState(false)

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cancelled = searchParams.get('cancelled') === 'true'

  useEffect(() => {
    async function load() {
      const [{ data: planData }, { data: currData }, { data: priceData }, { data: trial }] = await Promise.all([
        supabase.from('plan_configs').select('*').eq('is_active', true).order('sort_order'),
        supabase.from('currencies').select('code, symbol, flag, is_active, sort_order').eq('is_active', true).order('sort_order'),
        supabase.from('plan_currency_pricing').select('plan_id, currency_code, price_monthly, price_annual'),
        supabase.rpc('get_trial_days'),
      ])
      setPlans((planData ?? []) as PlanConfig[])
      setCurrencies((currData ?? []) as Currency[])
      setPrices((priceData ?? []) as PlanCurrencyPrice[])
      setTrialDays(typeof trial === 'number' ? trial : 0)
      setLoading(false)
    }
    void load()
  }, [])

  const currency = currencies.find(c => c.code === currencyCode)

  const priceFor = useCallback((planId: string): number => {
    const plan = plans.find(p => p.id === planId)
    if (!plan) return 0
    if (planId === 'free') return 0
    const specific = prices.find(p => p.plan_id === planId && p.currency_code === currencyCode)
    if (specific) return cycle === 'annual' ? specific.price_annual : specific.price_monthly
    return cycle === 'annual' ? plan.price_annual : plan.price_monthly
  }, [plans, prices, currencyCode, cycle])

  const chosenPlan = plans.find(p => p.id === selectedPlan)
  const chosenPrice = priceFor(selectedPlan)

  const formValid = useMemo(() => (
    form.companyName.trim().length > 0 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.adminEmail) &&
    form.password.length >= 8
  ), [form])

  function goToReview(e: React.FormEvent) {
    e.preventDefault()
    if (!formValid) return
    setError(null)
    setStep('review')
  }

  async function confirmSubscribe() {
    setSubmitting(true)
    setError(null)

    const { data, error: fnError } = await supabase.functions.invoke('provision-subscription', {
      body: {
        companyName: form.companyName.trim(),
        adminName: form.adminName.trim(),
        adminEmail: form.adminEmail.trim(),
        password: form.password,
        plan: selectedPlan,
        billingCycle: cycle,
        currencyCode,
      },
    })

    const result = data as { success?: boolean; code?: string; checkoutUrl?: string; error?: string } | null
    if (fnError || !result?.success) {
      setSubmitting(false)
      setError(result?.error ?? fnError?.message ?? 'Something went wrong. Please try again.')
      return
    }

    if (result.checkoutUrl) {
      window.location.href = result.checkoutUrl
      return
    }

    navigate(`/subscribe/thank-you?code=${result.code}&plan=free`)
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#F8FAFF' }}>
        <div className="w-8 h-8 border-4 border-violet-700 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen" style={{ background: 'linear-gradient(180deg, #F8FAFF 0%, #FFFFFF 340px)' }}>
      {/* ── Top bar ── */}
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <a href="https://digitracker.digi5y.co" className="flex items-center gap-2.5">
            <img src="/logo.png" alt="DIGITRACKER" className="w-8 h-8 rounded-lg object-contain" />
            <span
              className="font-heading font-extrabold tracking-tight text-base text-transparent bg-clip-text"
              style={{ backgroundImage: 'linear-gradient(135deg, #6D28D9 0%, #2563EB 100%)' }}
            >
              DIGITRACKER
            </span>
          </a>
          <Link to="/login" className="text-sm font-medium text-violet-700 hover:text-violet-800">
            Already have an account? Sign in →
          </Link>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
        {/* ── Step indicator ── */}
        <div className="flex items-center justify-center gap-3 mb-8 text-xs font-semibold">
          <span className={step === 'plan' ? 'text-violet-700' : 'text-slate-400'}>1. Choose your plan</span>
          <span className="text-slate-300">—</span>
          <span className={step === 'review' ? 'text-violet-700' : 'text-slate-400'}>2. Review & subscribe</span>
        </div>

        {cancelled && (
          <div className="max-w-lg mx-auto mb-6 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-700 text-center">
            Checkout was cancelled — no charge was made. Pick up where you left off below.
          </div>
        )}

        {step === 'plan' && (
          <div className="space-y-10">
            <div className="text-center max-w-xl mx-auto">
              <h1 className="font-heading text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900 mb-3">
                Start managing your remote team today
              </h1>
              <p className="text-slate-500 text-sm">
                {trialDays > 0
                  ? `Every paid plan includes a ${trialDays}-day free trial. Cancel any time.`
                  : 'Pick the plan that fits your team. Upgrade or downgrade any time.'}
              </p>
            </div>

            {/* Billing cycle + currency controls */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 text-sm">
                {(['monthly', 'annual'] as BillingCycle[]).map(c => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCycle(c)}
                    className={`px-4 py-2 rounded-lg font-semibold transition-colors ${
                      cycle === c ? 'bg-violet-700 text-white' : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    {c === 'monthly' ? 'Monthly' : 'Annual — save more'}
                  </button>
                ))}
              </div>
              <select
                value={currencyCode}
                onChange={e => setCurrencyCode(e.target.value)}
                className="border border-slate-200 rounded-xl bg-white px-3 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-violet-600"
              >
                {currencies.map(c => (
                  <option key={c.code} value={c.code}>{c.flag} {c.code}</option>
                ))}
              </select>
            </div>

            {/* Plan cards */}
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {plans.map(plan => {
                const price = priceFor(plan.id)
                const isSelected = selectedPlan === plan.id
                const isPopular = plan.id === POPULAR_PLAN_ID
                return (
                  <button
                    key={plan.id}
                    type="button"
                    onClick={() => setSelectedPlan(plan.id)}
                    className={`relative text-left rounded-2xl border-2 p-5 flex flex-col transition-all ${
                      isSelected
                        ? 'border-violet-700 bg-violet-50/50 shadow-md'
                        : 'border-slate-200 bg-white hover:border-violet-300'
                    }`}
                  >
                    {isPopular && (
                      <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-violet-700 text-white text-[10px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full">
                        Most Popular
                      </span>
                    )}
                    <p className="font-heading font-bold text-slate-900 mt-1">{plan.name}</p>
                    <p className="mt-2">
                      <span className="font-heading text-2xl font-extrabold text-slate-900">
                        {plan.id === 'free' ? 'Free' : `${currency?.symbol ?? '$'}${price.toFixed(2)}`}
                      </span>
                      {plan.id !== 'free' && (
                        <span className="text-xs text-slate-400"> /{cycle === 'annual' ? 'yr' : 'mo'}</span>
                      )}
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">Up to {plan.max_seats} users</p>
                    <ul className="mt-4 space-y-1.5 text-xs text-slate-600 flex-1">
                      {plan.features.slice(0, 5).map(f => (
                        <li key={f} className="flex items-start gap-1.5">
                          <span className="text-violet-600 flex-shrink-0">✓</span> {f}
                        </li>
                      ))}
                    </ul>
                    <div className={`mt-4 text-center text-xs font-semibold rounded-lg py-2 ${
                      isSelected ? 'bg-violet-700 text-white' : 'bg-slate-100 text-slate-600'
                    }`}>
                      {isSelected ? '✓ Selected' : 'Select plan'}
                    </div>
                  </button>
                )
              })}
            </div>

            {/* Company + admin details */}
            <form onSubmit={goToReview} className="max-w-md mx-auto bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
              <h2 className="font-heading font-bold text-slate-900">Your business details</h2>

              <Field label="Business / Company Name">
                <input required value={form.companyName}
                  onChange={e => setForm(f => ({ ...f, companyName: e.target.value }))}
                  placeholder="Acme Corp" className="input" />
              </Field>
              <Field label="Your Full Name">
                <input value={form.adminName}
                  onChange={e => setForm(f => ({ ...f, adminName: e.target.value }))}
                  placeholder="Jane Smith" className="input" />
              </Field>
              <Field label="Work Email">
                <input required type="email" value={form.adminEmail}
                  onChange={e => setForm(f => ({ ...f, adminEmail: e.target.value }))}
                  placeholder="you@company.com" className="input" />
              </Field>
              <Field label="Password">
                <div className="relative">
                  <input required type={showPass ? 'text' : 'password'} value={form.password}
                    onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                    placeholder="At least 8 characters" className="input pr-14" />
                  <button type="button" onClick={() => setShowPass(p => !p)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-600">
                    {showPass ? 'Hide' : 'Show'}
                  </button>
                </div>
              </Field>

              <button type="submit" disabled={!formValid}
                className="w-full bg-violet-700 hover:bg-violet-800 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-violet-600/30 disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none text-white rounded-lg py-3 text-sm font-semibold transition-all"
                style={{ minHeight: '46px' }}>
                Continue to Review →
              </button>
            </form>
          </div>
        )}

        {step === 'review' && chosenPlan && (
          <div className="max-w-md mx-auto bg-white rounded-2xl border border-slate-200 p-6 space-y-5">
            <h2 className="font-heading font-bold text-slate-900 text-lg">Review your order</h2>

            <div className="rounded-xl bg-[#F8FAFF] border border-slate-200 divide-y divide-slate-200">
              <SummaryRow label="Business" value={form.companyName} />
              <SummaryRow label="Admin" value={form.adminEmail} />
              <SummaryRow label="Plan" value={`${chosenPlan.name} · ${cycle === 'annual' ? 'Annual' : 'Monthly'}`} />
              <SummaryRow
                label="Price"
                value={chosenPlan.id === 'free' ? 'Free forever' : `${currency?.symbol ?? '$'}${chosenPrice.toFixed(2)} / ${cycle === 'annual' ? 'year' : 'month'}`}
              />
              {chosenPlan.id !== 'free' && trialDays > 0 && (
                <SummaryRow label="Free trial" value={`${trialDays} days, then billed automatically`} />
              )}
            </div>

            {chosenPlan.id !== 'free' && (
              <p className="text-xs text-slate-400">
                You'll be redirected to Stripe's secure checkout to add a payment method.
                {trialDays > 0 ? ' You will not be charged until your trial ends.' : ''}
              </p>
            )}

            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="flex gap-3">
              <button type="button" onClick={() => setStep('plan')}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50">
                ← Back
              </button>
              <button type="button" onClick={() => void confirmSubscribe()} disabled={submitting}
                className="flex-1 py-2.5 rounded-xl bg-violet-700 hover:bg-violet-800 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-violet-600/30 text-white text-sm font-semibold disabled:opacity-50 disabled:transform-none disabled:shadow-none transition-all">
                {submitting ? 'Processing…' : chosenPlan.id === 'free' ? 'Start Free Plan' : 'Confirm & Subscribe'}
              </button>
            </div>
          </div>
        )}

        <footer className="text-center mt-16">
          <Link to="/" className="text-xs text-slate-400 hover:text-violet-700 transition-colors">
            Know more about DIGITRACKER by DIGI5Y →
          </Link>
        </footer>
      </main>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
      {children}
    </div>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5 text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-gray-900 text-right">{value}</span>
    </div>
  )
}
