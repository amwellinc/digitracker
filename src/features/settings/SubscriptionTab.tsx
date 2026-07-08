import { useState, useEffect } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import type { Subscription } from '@/types'

interface Plan {
  id: 'free' | 'basic' | 'business' | 'professional'
  name: string
  price: string
  seats: string
  features: string[]
  priceEnvKey?: string
  popular?: boolean
}

const PLANS: Plan[] = [
  {
    id: 'free',
    name: 'Free',
    price: '$0',
    seats: '3 users',
    features: ['Time tracking', 'Screenshots (7-day)', 'Basic reports'],
  },
  {
    id: 'basic',
    name: 'Basic',
    price: '$19.90',
    seats: '10 users',
    features: ['Everything in Free', 'Calendar & Leave', 'Tasks & KPIs', '30-day screenshots', 'Email support'],
    priceEnvKey: 'VITE_STRIPE_BASIC_PRICE_ID',
  },
  {
    id: 'business',
    name: 'Business',
    price: '$39.90',
    seats: '100 users',
    features: ['Everything in Basic', 'Documents module', 'Advanced reports', 'GHL integration', 'Priority support'],
    popular: true,
    priceEnvKey: 'VITE_STRIPE_BUSINESS_PRICE_ID',
  },
  {
    id: 'professional',
    name: 'Professional',
    price: '$99.90',
    seats: '1,000 users',
    features: ['Everything in Business', 'Custom branding', 'API access', 'Dedicated support', 'SLA guarantee'],
    priceEnvKey: 'VITE_STRIPE_PROFESSIONAL_PRICE_ID',
  },
]

const PLAN_ORDER: Record<Plan['id'], number> = { free: 0, basic: 1, business: 2, professional: 3 }

export function SubscriptionTab() {
  const { user } = useAuth()
  const [sub, setSub] = useState<Subscription | null>(null)
  const [loading, setLoading] = useState(true)
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null)
  const [portalLoading, setPortalLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    void (async () => {
      const { data } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('sub_account', user.sub_account)
        .maybeSingle()
      setSub(data as Subscription | null)
      setLoading(false)
    })()
  }, [user])

  const currentPlan = sub?.plan ?? 'free'
  const currentIdx = PLAN_ORDER[currentPlan]

  async function handleUpgrade(plan: Plan) {
    if (!user || !plan.priceEnvKey) return
    setCheckoutLoading(plan.id)
    setError(null)
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('create-checkout', {
        body: { plan: plan.id, email: user.email, sub_account: user.sub_account },
      })
      if (fnErr) throw new Error(fnErr.message)
      if (data?.url) window.location.href = data.url as string
    } catch (e) {
      setError('Payment portal unavailable right now. Contact support@digi5y.com.')
    } finally {
      setCheckoutLoading(null)
    }
  }

  async function handlePortal() {
    if (!user) return
    setPortalLoading(true)
    setError(null)
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('create-portal', {
        body: { sub_account: user.sub_account },
      })
      if (fnErr) throw new Error(fnErr.message)
      if (data?.url) window.location.href = data.url as string
    } catch {
      setError('Billing portal unavailable right now. Contact support@digi5y.com.')
    } finally {
      setPortalLoading(false)
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-40 text-sm text-gray-400">Loading subscription…</div>
  }

  return (
    <div>
      {/* Current Plan Banner */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Current Plan</h2>
            <div className="flex items-center gap-3">
              <span className="inline-block bg-violet-100 text-violet-700 text-sm font-semibold px-3 py-1 rounded-full capitalize">
                {currentPlan}
              </span>
              {sub?.status && (
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                  sub.status === 'active' ? 'bg-green-100 text-green-700' :
                  sub.status === 'trialing' ? 'bg-amber-100 text-amber-700' :
                  'bg-red-100 text-red-700'
                }`}>
                  {sub.status}
                </span>
              )}
            </div>
            {sub && (
              <div className="mt-2 text-sm text-gray-500 space-y-0.5">
                {sub.seats > 0 && <p>Seats: <strong className="text-gray-700">{sub.seats}</strong></p>}
                {sub.billing_date && (
                  <p>Next billing: <strong className="text-gray-700">
                    {new Date(sub.billing_date).toLocaleDateString('en-SG', { year: 'numeric', month: 'long', day: 'numeric' })}
                  </strong></p>
                )}
              </div>
            )}
          </div>
          {currentPlan !== 'free' && (
            <button
              onClick={handlePortal}
              disabled={portalLoading}
              className="btn-ghost text-sm"
            >
              {portalLoading ? 'Loading…' : 'Manage Billing →'}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 text-sm text-red-700">{error}</div>
      )}

      {/* Pricing Cards */}
      <h3 className="text-base font-semibold text-gray-800 mb-4">Plans & Pricing</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {PLANS.map(plan => {
          const isCurrent = plan.id === currentPlan
          const isDowngrade = PLAN_ORDER[plan.id] < currentIdx
          const isUpgrade = PLAN_ORDER[plan.id] > currentIdx

          return (
            <div
              key={plan.id}
              className={`relative flex flex-col rounded-2xl border-2 p-5 transition-shadow ${
                plan.popular
                  ? 'border-violet-500 shadow-lg shadow-violet-100'
                  : isCurrent
                  ? 'border-green-400'
                  : 'border-gray-200'
              }`}
            >
              {plan.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="bg-violet-600 text-white text-xs font-semibold px-3 py-1 rounded-full">
                    Most Popular
                  </span>
                </div>
              )}
              {isCurrent && (
                <div className="absolute -top-3 right-4">
                  <span className="bg-green-600 text-white text-xs font-semibold px-3 py-1 rounded-full">
                    Current
                  </span>
                </div>
              )}

              <div className="mb-4">
                <h4 className="text-base font-bold text-gray-900">{plan.name}</h4>
                <div className="flex items-end gap-1 mt-1">
                  <span className="text-2xl font-extrabold text-gray-900">{plan.price}</span>
                  {plan.id !== 'free' && <span className="text-gray-500 text-sm mb-0.5">/mo</span>}
                </div>
                <p className="text-xs text-gray-500 mt-1">Up to {plan.seats}</p>
              </div>

              <ul className="space-y-1.5 flex-1 mb-5">
                {plan.features.map(f => (
                  <li key={f} className="flex items-start gap-2 text-xs text-gray-600">
                    <span className="text-green-500 mt-0.5">✓</span>
                    {f}
                  </li>
                ))}
              </ul>

              {isCurrent ? (
                <div className="border border-green-400 rounded-lg py-2 text-center text-sm font-medium text-green-600">
                  Current Plan
                </div>
              ) : plan.id === 'free' ? (
                isDowngrade ? (
                  <div className="border border-gray-200 rounded-lg py-2 text-center text-sm text-gray-400 cursor-not-allowed">
                    Downgrade at period end
                  </div>
                ) : null
              ) : (
                <button
                  onClick={() => handleUpgrade(plan)}
                  disabled={checkoutLoading === plan.id || isCurrent}
                  className={`w-full rounded-lg py-2 text-sm font-semibold transition-colors ${
                    plan.popular
                      ? 'bg-violet-600 text-white hover:bg-violet-700'
                      : isUpgrade
                      ? 'bg-gray-900 text-white hover:bg-gray-800'
                      : 'border border-gray-300 text-gray-600 hover:bg-gray-50'
                  } disabled:opacity-50`}
                >
                  {checkoutLoading === plan.id ? 'Redirecting…' : isDowngrade ? 'Downgrade' : 'Upgrade →'}
                </button>
              )}
            </div>
          )
        })}
      </div>

      <p className="text-xs text-gray-400 mt-4">
        Payments processed securely by Stripe. Cancel or change plans anytime from Manage Billing.
        Plan downgrades take effect at the end of the current billing period.
      </p>
    </div>
  )
}
