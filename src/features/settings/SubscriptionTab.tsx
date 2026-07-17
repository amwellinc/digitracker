import { useState, useEffect } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import type { Subscription } from '@/types'
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

const PLAN_ORDER: Record<string, number> = { free: 0, basic: 1, business: 2, professional: 3 }

export function SubscriptionTab() {
  const { user } = useAuth()
  const [sub, setSub] = useState<Subscription | null>(null)
  const [plans, setPlans] = useState<PlanConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null)
  const [portalLoading, setPortalLoading] = useState(false)
  const [cancelConfirm, setCancelConfirm] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    void (async () => {
      const [{ data: subData }, { data: planData }] = await Promise.all([
        supabase.from('subscriptions').select('*').eq('sub_account', user.sub_account).maybeSingle(),
        supabase.from('plan_configs').select('*').eq('is_active', true).order('sort_order'),
      ])
      setSub(subData as Subscription | null)
      setPlans((planData ?? []) as PlanConfig[])
      setLoading(false)
    })()
  }, [user])

  const currentPlan = sub?.plan ?? 'free'
  const currentIdx = PLAN_ORDER[currentPlan] ?? 0

  async function handleUpgrade(plan: PlanConfig) {
    if (!user) return
    setCheckoutLoading(plan.id)
    setError(null)
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('create-checkout', {
        body: { plan: plan.id, email: user.email, sub_account: user.sub_account },
      })
      if (fnErr) throw new Error(fnErr.message)
      if (data?.url) window.location.href = data.url as string
    } catch {
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

  async function handleCancel() {
    if (!user || !sub) return
    setCancelling(true)
    setError(null)
    const { error } = await supabase
      .from('subscriptions')
      .update({ status: 'cancelled' })
      .eq('sub_account', user.sub_account)
    setCancelling(false)
    if (error) { setError(error.message); return }
    setSub(prev => prev ? { ...prev, status: 'cancelled' } : prev)
    setCancelConfirm(false)
    setSuccess('Your subscription has been cancelled. Access continues until the end of the current billing period.')
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
            <div className="flex items-center gap-3 flex-wrap">
              <span className="inline-block bg-violet-100 text-violet-700 text-sm font-semibold px-3 py-1 rounded-full">
                {PLAN_LABELS[currentPlan] ?? currentPlan}
              </span>
              {sub?.status && (
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                  sub.status === 'active'    ? 'bg-green-100 text-green-700' :
                  sub.status === 'trialing'  ? 'bg-amber-100 text-amber-700' :
                  sub.status === 'cancelled' ? 'bg-red-100 text-red-600' :
                  'bg-gray-100 text-gray-600'
                }`}>
                  {sub.status}
                </span>
              )}
            </div>
            {sub && (
              <div className="mt-3 text-sm text-gray-500 space-y-1">
                {sub.seats > 0 && (
                  <p>Seats: <strong className="text-gray-700">{sub.seats}</strong></p>
                )}
                {sub.billing_cycle && (
                  <p>Billing: <strong className="text-gray-700 capitalize">{sub.billing_cycle}</strong></p>
                )}
                {sub.billing_date && (
                  <p>
                    {sub.status === 'cancelled' ? 'Access until' : 'Next billing'}:{' '}
                    <strong className="text-gray-700">
                      {new Date(sub.billing_date).toLocaleDateString('en-SG', { year: 'numeric', month: 'long', day: 'numeric' })}
                    </strong>
                  </p>
                )}
                <p>Account since: <strong className="text-gray-700">
                  {new Date(sub.created_at).toLocaleDateString('en-SG', { year: 'numeric', month: 'long', day: 'numeric' })}
                </strong></p>
              </div>
            )}
          </div>
          <div className="flex flex-col gap-2">
            {currentPlan !== 'free' && sub?.status !== 'cancelled' && (
              <button onClick={handlePortal} disabled={portalLoading} className="btn-ghost text-sm">
                {portalLoading ? 'Loading…' : 'Manage Billing →'}
              </button>
            )}
            {sub?.status === 'active' && currentPlan !== 'free' && (
              <button
                onClick={() => setCancelConfirm(true)}
                className="text-sm text-red-500 hover:text-red-700 font-medium text-left"
              >
                Cancel subscription
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Billing History */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <h3 className="text-sm font-semibold text-gray-800 mb-3">Billing History</h3>
        {sub ? (
          <div className="divide-y divide-gray-50">
            <div className="flex justify-between py-2.5 text-sm">
              <span className="text-gray-600">Account created</span>
              <span className="font-medium text-gray-800">
                {new Date(sub.created_at).toLocaleDateString('en-SG', { year: 'numeric', month: 'long', day: 'numeric' })}
              </span>
            </div>
            {sub.status === 'cancelled' && (
              <div className="flex justify-between py-2.5 text-sm">
                <span className="text-red-500">Subscription cancelled</span>
                <span className="font-medium text-red-600">Account marked cancelled</span>
              </div>
            )}
            <p className="text-xs text-gray-400 pt-3">
              Full invoice history will appear here once Stripe integration is enabled.
            </p>
          </div>
        ) : (
          <p className="text-sm text-gray-400">No billing records yet.</p>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 text-sm text-red-700">{error}</div>
      )}
      {success && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-6 text-sm text-green-700">{success}</div>
      )}

      {/* Pricing Cards */}
      <h3 className="text-base font-semibold text-gray-800 mb-4">Plans & Pricing</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {plans.map(plan => {
          const isCurrent = plan.id === currentPlan
          const planIdx = PLAN_ORDER[plan.id] ?? 0
          const isDowngrade = planIdx < currentIdx
          const isUpgrade = planIdx > currentIdx

          return (
            <div
              key={plan.id}
              className={`relative flex flex-col rounded-2xl border-2 p-5 transition-shadow ${
                plan.id === 'business'
                  ? 'border-violet-500 shadow-lg shadow-violet-100'
                  : isCurrent
                  ? 'border-green-400'
                  : 'border-gray-200'
              }`}
            >
              {plan.id === 'business' && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="bg-violet-600 text-white text-xs font-semibold px-3 py-1 rounded-full whitespace-nowrap">
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
                <h4 className="text-base font-bold text-gray-900">{PLAN_LABELS[plan.id] ?? plan.name}</h4>
                <div className="flex items-end gap-1 mt-1">
                  <span className="text-2xl font-extrabold text-gray-900">
                    {plan.price_monthly === 0 ? 'Free' : `$${plan.price_monthly.toFixed(2)}`}
                  </span>
                  {plan.price_monthly > 0 && <span className="text-gray-500 text-sm mb-0.5">/mo</span>}
                </div>
                {plan.price_annual > 0 && (
                  <p className="text-xs text-gray-500 mt-0.5">
                    ${plan.price_annual.toFixed(2)}/yr · save {Math.round((1 - plan.price_annual / (plan.price_monthly * 12)) * 100)}%
                  </p>
                )}
                <p className="text-xs text-gray-500 mt-1">Up to {plan.max_seats.toLocaleString()} users</p>
              </div>

              <ul className="space-y-1.5 flex-1 mb-5">
                {plan.features.map(f => (
                  <li key={f} className="flex items-start gap-2 text-xs text-gray-600">
                    <span className="text-green-500 mt-0.5 flex-shrink-0">✓</span>
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
                  <div className="border border-gray-200 rounded-lg py-2 text-center text-sm text-gray-400">
                    Downgrade at period end
                  </div>
                ) : null
              ) : (
                <button
                  onClick={() => handleUpgrade(plan)}
                  disabled={checkoutLoading === plan.id || isCurrent}
                  className={`w-full rounded-lg py-2 text-sm font-semibold transition-colors ${
                    plan.id === 'business'
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
        Payments processed securely by Stripe. Cancel anytime from Manage Billing.
        Downgrades take effect at the end of the current billing period.
      </p>

      {/* Cancel Confirmation Modal */}
      {cancelConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Cancel Subscription?</h3>
            <p className="text-sm text-gray-600 mb-5">
              Your access will continue until the end of the current billing period. After that, the account will revert to the Free plan.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setCancelConfirm(false)} className="flex-1 btn-ghost">Keep Plan</button>
              <button
                onClick={handleCancel}
                disabled={cancelling}
                className="flex-1 bg-red-500 hover:bg-red-600 text-white rounded-lg py-2 text-sm font-semibold transition-colors disabled:opacity-50"
              >
                {cancelling ? 'Cancelling…' : 'Yes, Cancel'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
