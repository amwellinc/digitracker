import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { PaymentTransactionsPanel } from './PaymentTransactionsPanel'

type SectionId = 'connection' | 'rules' | 'transactions' | 'emails'

interface EmailTemplate {
  enabled: boolean
  subject: string
  body: string
}

interface StripeConfig {
  id?: string
  stripe_publishable_key: string
  stripe_secret_key: string
  stripe_webhook_secret: string
  stripe_test_mode: boolean
  trial_days: number
  grace_period_days: number
  max_failed_attempts: number
  auto_renewal: boolean
  prorate_on_change: boolean
  invoice_prefix: string
  default_billing_cycle: 'monthly' | 'annual'
  tax_rate: number
  currency: string
  cancel_at_period_end: boolean
  tpl_new_subscription: EmailTemplate
  tpl_renewal_reminder: EmailTemplate
  tpl_payment_success: EmailTemplate
  tpl_subscription_changed: EmailTemplate
}

const MERGE_TAGS = [
  '{{first_name}}', '{{email}}', '{{company_name}}',
  '{{plan_name}}', '{{old_plan}}', '{{new_plan}}', '{{change_type}}', '{{change_note}}',
  '{{amount}}', '{{currency}}', '{{billing_cycle}}',
  '{{billing_date}}', '{{next_billing_date}}',
]

const DEFAULT_TPL_NEW: EmailTemplate = {
  enabled: true,
  subject: 'Your {{plan_name}} subscription is now active',
  body: `Hi {{first_name}},

Your subscription to the {{plan_name}} plan has been confirmed.

Plan: {{plan_name}}
Amount: {{currency}}{{amount}} / {{billing_cycle}}
Next billing date: {{billing_date}}

You now have full access to all features in your plan. Log in to get started.

Thank you for choosing DIGITRACKER.`,
}

const DEFAULT_TPL_REMINDER: EmailTemplate = {
  enabled: true,
  subject: 'Reminder — your {{plan_name}} subscription renews in 3 days',
  body: `Hi {{first_name}},

Your {{plan_name}} subscription will automatically renew in 3 days.

Renewal date: {{billing_date}}
Amount to be charged: {{currency}}{{amount}}

No action is needed — we will process the payment automatically using your card on file.

To update your payment method, go to Settings → Subscription in your account.

Thank you,
The DIGITRACKER Team`,
}

const DEFAULT_TPL_SUCCESS: EmailTemplate = {
  enabled: true,
  subject: 'Payment confirmed — {{plan_name}} subscription renewed',
  body: `Hi {{first_name}},

Your payment has been processed successfully.

Plan: {{plan_name}}
Amount paid: {{currency}}{{amount}}
Date: {{billing_date}}
Next renewal: {{next_billing_date}}

You can view your billing history under Settings → Subscription.

Thank you for your continued trust in DIGITRACKER.`,
}

const DEFAULT_TPL_CHANGED: EmailTemplate = {
  enabled: true,
  subject: 'Your DIGITRACKER subscription has been updated',
  body: `Hi {{first_name}},

Your subscription has been {{change_type}}.

Previous plan: {{old_plan}}
New plan: {{new_plan}}
{{change_note}}

If you did not authorise this change, please contact support immediately by replying to this email.

Thank you,
The DIGITRACKER Team`,
}

function defaultConfig(): StripeConfig {
  return {
    stripe_publishable_key: '',
    stripe_secret_key: '',
    stripe_webhook_secret: '',
    stripe_test_mode: true,
    trial_days: 14,
    grace_period_days: 3,
    max_failed_attempts: 3,
    auto_renewal: true,
    prorate_on_change: true,
    invoice_prefix: 'DT-',
    default_billing_cycle: 'monthly',
    tax_rate: 0,
    currency: 'USD',
    cancel_at_period_end: true,
    tpl_new_subscription: DEFAULT_TPL_NEW,
    tpl_renewal_reminder: DEFAULT_TPL_REMINDER,
    tpl_payment_success:  DEFAULT_TPL_SUCCESS,
    tpl_subscription_changed: DEFAULT_TPL_CHANGED,
  }
}

const SECTIONS: { id: SectionId; label: string; icon: string; desc: string }[] = [
  { id: 'connection',   label: 'Stripe Connection',    icon: '🔗', desc: 'API keys and webhook endpoint' },
  { id: 'rules',        label: 'Subscription Rules',   icon: '⚙️',  desc: 'Trial, billing, and payment settings' },
  { id: 'transactions', label: 'Transactions',         icon: '📜', desc: 'Payment history and analytics' },
  { id: 'emails',       label: 'Email Notifications',  icon: '✉️',  desc: 'Automated subscription emails' },
]

const CURRENCIES = ['USD', 'SGD', 'MYR', 'PHP', 'INR', 'AUD', 'GBP', 'AED', 'IDR', 'THB', 'JPY']

export function StripePaymentsTab() {
  const [activeSection, setActiveSection] = useState<SectionId>('connection')
  const [config, setConfig] = useState<StripeConfig>(defaultConfig())
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [showSk, setShowSk]     = useState(false)
  const [showWh, setShowWh]     = useState(false)
  const [hasSecretKey, setHasSecretKey] = useState(false)
  const [hasWebhookSecret, setHasWebhookSecret] = useState(false)
  const [expandedTpl, setExpandedTpl] = useState<keyof Pick<StripeConfig, 'tpl_new_subscription' | 'tpl_renewal_reminder' | 'tpl_payment_success' | 'tpl_subscription_changed'> | null>(null)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    // Deliberately excludes stripe_secret_key and stripe_webhook_secret — those
    // must never round-trip to the browser once saved. Leaving them blank here
    // means "not yet entered" and "already saved, unchanged" look identical,
    // which is the point: there's no way to read a saved secret back out.
    const { data } = await supabase
      .from('stripe_settings')
      .select('id, stripe_publishable_key, stripe_test_mode, trial_days, grace_period_days, max_failed_attempts, auto_renewal, prorate_on_change, invoice_prefix, default_billing_cycle, tax_rate, currency, cancel_at_period_end, tpl_new_subscription, tpl_renewal_reminder, tpl_payment_success, tpl_subscription_changed, has_secret_key, has_webhook_secret')
      .limit(1)
      .maybeSingle()
    if (data) {
      setHasSecretKey(Boolean(data.has_secret_key))
      setHasWebhookSecret(Boolean(data.has_webhook_secret))
      setConfig({
        id: data.id,
        stripe_publishable_key: data.stripe_publishable_key ?? '',
        stripe_secret_key:      '',
        stripe_webhook_secret:  '',
        stripe_test_mode:       data.stripe_test_mode       ?? true,
        trial_days:             data.trial_days             ?? 14,
        grace_period_days:      data.grace_period_days      ?? 3,
        max_failed_attempts:    data.max_failed_attempts    ?? 3,
        auto_renewal:           data.auto_renewal           ?? true,
        prorate_on_change:      data.prorate_on_change      ?? true,
        invoice_prefix:         data.invoice_prefix         ?? 'DT-',
        default_billing_cycle:  data.default_billing_cycle  ?? 'monthly',
        tax_rate:               data.tax_rate               ?? 0,
        currency:               data.currency               ?? 'USD',
        cancel_at_period_end:   data.cancel_at_period_end   ?? true,
        tpl_new_subscription:   data.tpl_new_subscription   ?? DEFAULT_TPL_NEW,
        tpl_renewal_reminder:   data.tpl_renewal_reminder   ?? DEFAULT_TPL_REMINDER,
        tpl_payment_success:    data.tpl_payment_success    ?? DEFAULT_TPL_SUCCESS,
        tpl_subscription_changed: data.tpl_subscription_changed ?? DEFAULT_TPL_CHANGED,
      })
    }
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  function patch<K extends keyof StripeConfig>(key: K, val: StripeConfig[K]) {
    setConfig(c => ({ ...c, [key]: val }))
  }

  function patchTpl(
    key: 'tpl_new_subscription' | 'tpl_renewal_reminder' | 'tpl_payment_success' | 'tpl_subscription_changed',
    field: keyof EmailTemplate,
    val: string | boolean,
  ) {
    setConfig(c => ({ ...c, [key]: { ...c[key], [field]: val } }))
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setMsg(null)

    // Secrets are only ever included in the write when the admin actually typed
    // something new — an empty field means "leave the saved value alone", never
    // "clear it". This is what makes it safe to never read them back on load.
    const secretPatch: { stripe_secret_key?: string; stripe_webhook_secret?: string } = {}
    if (config.stripe_secret_key.trim())     secretPatch.stripe_secret_key = config.stripe_secret_key.trim()
    if (config.stripe_webhook_secret.trim()) secretPatch.stripe_webhook_secret = config.stripe_webhook_secret.trim()

    const payload = {
      stripe_publishable_key: config.stripe_publishable_key.trim(),
      ...secretPatch,
      stripe_test_mode:       config.stripe_test_mode,
      trial_days:             config.trial_days,
      grace_period_days:      config.grace_period_days,
      max_failed_attempts:    config.max_failed_attempts,
      auto_renewal:           config.auto_renewal,
      prorate_on_change:      config.prorate_on_change,
      invoice_prefix:         config.invoice_prefix.trim(),
      default_billing_cycle:  config.default_billing_cycle,
      tax_rate:               config.tax_rate,
      currency:               config.currency,
      cancel_at_period_end:   config.cancel_at_period_end,
      tpl_new_subscription:   config.tpl_new_subscription,
      tpl_renewal_reminder:   config.tpl_renewal_reminder,
      tpl_payment_success:    config.tpl_payment_success,
      tpl_subscription_changed: config.tpl_subscription_changed,
      updated_at: new Date().toISOString(),
    }

    const safeColumns = 'id, stripe_publishable_key, has_secret_key, has_webhook_secret'
    let error: { message: string } | null = null
    if (config.id) {
      const { error: updateErr } = await supabase.from('stripe_settings').update(payload).eq('id', config.id)
      error = updateErr
    } else {
      const { data, error: insertErr } = await supabase
        .from('stripe_settings').insert(payload).select(safeColumns).single()
      error = insertErr
      if (data) patch('id', (data as { id: string }).id)
    }

    if (!error) {
      // Re-fetch just the two "is a secret saved" flags rather than trusting
      // local state, so the UI reflects what's actually in the database.
      const { data: refreshed } = await supabase
        .from('stripe_settings').select('has_secret_key, has_webhook_secret').eq('id', config.id).maybeSingle()
      if (refreshed) {
        setHasSecretKey(Boolean(refreshed.has_secret_key))
        setHasWebhookSecret(Boolean(refreshed.has_webhook_secret))
      }
      patch('stripe_secret_key', '')
      patch('stripe_webhook_secret', '')
    }

    setSaving(false)
    setMsg(error
      ? { type: 'error', text: error.message }
      : { type: 'success', text: 'Settings saved successfully.' }
    )
    setTimeout(() => setMsg(null), 4000)
  }

  const isConnected = config.stripe_publishable_key.startsWith('pk_') && hasSecretKey

  if (loading) {
    return <div className="flex items-center justify-center h-48 text-sm text-gray-400">Loading…</div>
  }

  return (
    <div>
      <div className="mb-5">
        <h2 className="text-base font-semibold text-gray-900">Payments</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Connect Stripe, configure billing rules, review transaction history, and manage subscription email notifications.
        </p>
      </div>

      {/* Section nav */}
      <div className="flex gap-3 mb-6 flex-wrap">
        {SECTIONS.map(s => (
          <button
            key={s.id}
            onClick={() => setActiveSection(s.id)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-medium transition-colors ${
              activeSection === s.id
                ? 'bg-violet-600 text-white border-violet-600 shadow-sm'
                : 'bg-white text-gray-600 border-gray-200 hover:border-violet-300 hover:text-violet-700'
            }`}
          >
            <span>{s.icon}</span>
            {s.label}
            {s.id === 'connection' && (
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isConnected ? 'bg-emerald-400' : 'bg-red-400'}`} />
            )}
          </button>
        ))}
      </div>

      <form onSubmit={handleSave}>

        {/* ── Stripe Connection ─────────────────────────────── */}
        {activeSection === 'connection' && (
          <div className="space-y-6 max-w-2xl">

            {/* Status banner */}
            <div className={`rounded-xl border px-5 py-4 flex items-start gap-4 ${
              isConnected
                ? 'bg-emerald-50 border-emerald-200'
                : 'bg-amber-50 border-amber-200'
            }`}>
              <span className="text-2xl">{isConnected ? '✅' : '⚠️'}</span>
              <div>
                <p className={`font-semibold text-sm ${isConnected ? 'text-emerald-800' : 'text-amber-800'}`}>
                  {isConnected
                    ? `Stripe connected — ${config.stripe_test_mode ? 'Test Mode' : 'Live Mode'}`
                    : 'Stripe not connected'}
                </p>
                <p className={`text-xs mt-0.5 ${isConnected ? 'text-emerald-600' : 'text-amber-600'}`}>
                  {isConnected
                    ? 'Your Stripe keys are saved. Subscription payments will be processed automatically.'
                    : 'Add your Stripe API keys below to start collecting subscription payments.'}
                </p>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">

              {/* Test mode toggle */}
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div>
                  <p className="text-sm font-medium text-gray-800">Test Mode</p>
                  <p className="text-xs text-gray-500 mt-0.5">Use Stripe test keys (no real charges). Disable for live payments.</p>
                </div>
                <button
                  type="button"
                  onClick={() => patch('stripe_test_mode', !config.stripe_test_mode)}
                  className={`relative inline-flex h-6 w-11 rounded-full transition-colors ${
                    config.stripe_test_mode ? 'bg-amber-400' : 'bg-emerald-500'
                  }`}
                >
                  <span className={`inline-block h-5 w-5 rounded-full bg-white shadow mt-0.5 transition-transform ${
                    config.stripe_test_mode ? 'translate-x-0.5' : 'translate-x-5'
                  }`} />
                </button>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Publishable Key</label>
                <input
                  value={config.stripe_publishable_key}
                  onChange={e => patch('stripe_publishable_key', e.target.value)}
                  placeholder={config.stripe_test_mode ? 'pk_test_...' : 'pk_live_...'}
                  className="input font-mono text-sm"
                />
                <p className="text-xs text-gray-400 mt-1">Safe to expose in client-side code. Found in Stripe Dashboard → Developers → API Keys.</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Secret Key {hasSecretKey && <span className="text-emerald-600 font-normal">· ✓ saved</span>}
                </label>
                <div className="relative">
                  <input
                    type={showSk ? 'text' : 'password'}
                    value={config.stripe_secret_key}
                    onChange={e => patch('stripe_secret_key', e.target.value)}
                    placeholder={hasSecretKey ? '••••••••••••  (leave blank to keep the saved key)' : (config.stripe_test_mode ? 'sk_test_...' : 'sk_live_...')}
                    className="input font-mono text-sm pr-16"
                  />
                  <button type="button" onClick={() => setShowSk(p => !p)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-600">
                    {showSk ? 'Hide' : 'Show'}
                  </button>
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  Never displayed once saved — this field is write-only. Leave it blank to keep the currently saved key, or type a new one to replace it.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Webhook Secret {hasWebhookSecret && <span className="text-emerald-600 font-normal">· ✓ saved</span>}
                </label>
                <div className="relative">
                  <input
                    type={showWh ? 'text' : 'password'}
                    value={config.stripe_webhook_secret}
                    onChange={e => patch('stripe_webhook_secret', e.target.value)}
                    placeholder={hasWebhookSecret ? '••••••••••••  (leave blank to keep the saved secret)' : 'whsec_...'}
                    className="input font-mono text-sm pr-16"
                  />
                  <button type="button" onClick={() => setShowWh(p => !p)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-600">
                    {showWh ? 'Hide' : 'Show'}
                  </button>
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  Created in Stripe Dashboard → Webhooks. Point your webhook at{' '}
                  <code className="bg-gray-100 px-1 rounded">{import.meta.env.VITE_SUPABASE_URL}/functions/v1/stripe-webhook</code>.
                </p>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-2">
                <p className="text-sm font-medium text-blue-800">Stripe Webhook Events to Enable</p>
                <ul className="text-xs text-blue-700 space-y-1 list-disc list-inside">
                  <li><code>checkout.session.completed</code> — new subscription activated</li>
                  <li><code>invoice.payment_succeeded</code> — recurring payment confirmed</li>
                  <li><code>invoice.payment_failed</code> — payment failed, trigger grace period</li>
                  <li><code>customer.subscription.updated</code> — plan changed or seats modified</li>
                  <li><code>customer.subscription.deleted</code> — subscription cancelled</li>
                  <li><code>invoice.upcoming</code> — renewal reminder (3 days prior)</li>
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* ── Subscription Rules ────────────────────────────── */}
        {activeSection === 'rules' && (
          <div className="space-y-6 max-w-2xl">

            <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Trial & Billing</p>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Trial Period (days)</label>
                  <input type="number" min={0} max={90}
                    value={config.trial_days}
                    onChange={e => patch('trial_days', Number(e.target.value))}
                    className="input" />
                  <p className="text-xs text-gray-400 mt-1">0 = no trial. Default: 14 days.</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Default Billing Cycle</label>
                  <select
                    value={config.default_billing_cycle}
                    onChange={e => patch('default_billing_cycle', e.target.value as 'monthly' | 'annual')}
                    className="input"
                  >
                    <option value="monthly">Monthly</option>
                    <option value="annual">Annual</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Currency</label>
                  <select value={config.currency} onChange={e => patch('currency', e.target.value)} className="input">
                    {CURRENCIES.map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Tax Rate (%)</label>
                  <input type="number" min={0} max={100} step={0.01}
                    value={config.tax_rate}
                    onChange={e => patch('tax_rate', Number(e.target.value))}
                    className="input" />
                  <p className="text-xs text-gray-400 mt-1">Applied on top of plan price. 0 = no tax.</p>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Invoice Number Prefix</label>
                <input
                  value={config.invoice_prefix}
                  onChange={e => patch('invoice_prefix', e.target.value)}
                  placeholder="DT-"
                  className="input w-40"
                />
                <p className="text-xs text-gray-400 mt-1">e.g. DT- → DT-0001, DT-0002…</p>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Failed Payments & Grace Period</p>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Grace Period (days)</label>
                  <input type="number" min={0} max={30}
                    value={config.grace_period_days}
                    onChange={e => patch('grace_period_days', Number(e.target.value))}
                    className="input" />
                  <p className="text-xs text-gray-400 mt-1">Days to keep access after a failed payment before suspending.</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Max Failed Attempts</label>
                  <input type="number" min={1} max={10}
                    value={config.max_failed_attempts}
                    onChange={e => patch('max_failed_attempts', Number(e.target.value))}
                    className="input" />
                  <p className="text-xs text-gray-400 mt-1">Auto-cancel subscription after this many failures.</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Cancellation & Plan Changes</p>

              {[
                {
                  key: 'auto_renewal' as const,
                  label: 'Auto-Renewal',
                  desc: 'Automatically renew subscriptions at the end of each billing period.',
                },
                {
                  key: 'cancel_at_period_end' as const,
                  label: 'Cancel at Period End',
                  desc: 'When cancelled, keep access until the end of the current billing period (recommended).',
                },
                {
                  key: 'prorate_on_change' as const,
                  label: 'Prorate Plan Changes',
                  desc: 'Charge or credit the difference when a plan is upgraded or downgraded mid-cycle.',
                },
              ].map(item => (
                <div key={item.key} className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-800">{item.label}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{item.desc}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => patch(item.key, !config[item.key])}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full transition-colors mt-0.5 ${
                      config[item.key] ? 'bg-violet-600' : 'bg-gray-300'
                    }`}
                  >
                    <span className={`inline-block h-5 w-5 rounded-full bg-white shadow mt-0.5 transition-transform ${
                      config[item.key] ? 'translate-x-5' : 'translate-x-0.5'
                    }`} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Transactions ─────────────────────────────────── */}
        {activeSection === 'transactions' && <PaymentTransactionsPanel />}

        {/* ── Email Notifications ───────────────────────────── */}
        {activeSection === 'emails' && (
          <div className="space-y-4 max-w-3xl">

            <div className="bg-blue-50 border border-blue-200 rounded-xl px-5 py-3 text-sm text-blue-800">
              Emails are sent automatically when subscription events occur. Requires SMTP to be configured in{' '}
              <button type="button" className="underline font-medium" onClick={() => {}}>Platform Settings</button>.
              Use merge tags to personalise each email.
            </div>

            {/* Merge tags reference */}
            <div className="bg-gray-50 border border-gray-200 rounded-xl px-5 py-3">
              <p className="text-xs font-semibold text-gray-600 mb-2">Available Merge Tags</p>
              <div className="flex flex-wrap gap-1.5">
                {MERGE_TAGS.map(tag => (
                  <code key={tag} className="text-xs bg-white border border-gray-200 px-2 py-0.5 rounded font-mono text-violet-700">
                    {tag}
                  </code>
                ))}
              </div>
            </div>

            {(
              [
                {
                  key: 'tpl_new_subscription' as const,
                  icon: '🎉',
                  title: 'New Subscription Activated',
                  trigger: 'Sent when a sub-account successfully subscribes to a paid plan for the first time.',
                  badge: 'On checkout.session.completed',
                },
                {
                  key: 'tpl_renewal_reminder' as const,
                  icon: '🔔',
                  title: 'Renewal Reminder (3 Days)',
                  trigger: 'Sent 3 days before the next billing date so customers can update their payment details.',
                  badge: 'On invoice.upcoming',
                },
                {
                  key: 'tpl_payment_success' as const,
                  icon: '✅',
                  title: 'Subscription Renewed Successfully',
                  trigger: 'Sent each time a recurring subscription payment is processed successfully.',
                  badge: 'On invoice.payment_succeeded',
                },
                {
                  key: 'tpl_subscription_changed' as const,
                  icon: '🔄',
                  title: 'Subscription Changed',
                  trigger: 'Sent when a subscription is upgraded, downgraded, or cancelled.',
                  badge: 'On customer.subscription.updated/deleted',
                },
              ] as const
            ).map(tpl => {
              const t = config[tpl.key]
              const isOpen = expandedTpl === tpl.key
              return (
                <div key={tpl.key} className={`bg-white rounded-xl border overflow-hidden transition-all ${
                  t.enabled ? 'border-gray-200' : 'border-gray-200 opacity-60'
                }`}>
                  {/* Template card header */}
                  <div className="flex items-start justify-between px-5 py-4">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <span className="text-xl flex-shrink-0 mt-0.5">{tpl.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold text-gray-900">{tpl.title}</p>
                          <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full font-mono">
                            {tpl.badge}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5">{tpl.trigger}</p>
                        {!isOpen && (
                          <p className="text-xs text-gray-400 mt-1 truncate">
                            Subject: {t.subject || '(not set)'}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0 ml-3">
                      {/* Enable toggle */}
                      <button
                        type="button"
                        onClick={() => patchTpl(tpl.key, 'enabled', !t.enabled)}
                        className={`relative inline-flex h-6 w-11 rounded-full transition-colors ${
                          t.enabled ? 'bg-violet-600' : 'bg-gray-300'
                        }`}
                      >
                        <span className={`inline-block h-5 w-5 rounded-full bg-white shadow mt-0.5 transition-transform ${
                          t.enabled ? 'translate-x-5' : 'translate-x-0.5'
                        }`} />
                      </button>
                      {/* Expand button */}
                      <button
                        type="button"
                        onClick={() => setExpandedTpl(isOpen ? null : tpl.key)}
                        className="text-xs font-medium text-violet-600 hover:text-violet-800 border border-violet-200 hover:border-violet-400 px-3 py-1.5 rounded-lg transition-colors"
                      >
                        {isOpen ? 'Close' : 'Edit'}
                      </button>
                    </div>
                  </div>

                  {/* Template editor (expanded) */}
                  {isOpen && (
                    <div className="border-t border-gray-100 px-5 pb-5 pt-4 space-y-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Subject Line</label>
                        <input
                          value={t.subject}
                          onChange={e => patchTpl(tpl.key, 'subject', e.target.value)}
                          className="input text-sm"
                          placeholder="Enter email subject..."
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Email Body (plain text)</label>
                        <textarea
                          rows={12}
                          value={t.body}
                          onChange={e => patchTpl(tpl.key, 'body', e.target.value)}
                          className="input resize-y font-mono text-xs leading-relaxed"
                          placeholder="Enter email body..."
                        />
                        <p className="text-xs text-gray-400 mt-1">
                          Use merge tags from the list above to personalise the email for each recipient.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const defaults: Record<string, EmailTemplate> = {
                            tpl_new_subscription: DEFAULT_TPL_NEW,
                            tpl_renewal_reminder: DEFAULT_TPL_REMINDER,
                            tpl_payment_success:  DEFAULT_TPL_SUCCESS,
                            tpl_subscription_changed: DEFAULT_TPL_CHANGED,
                          }
                          patch(tpl.key, defaults[tpl.key])
                        }}
                        className="text-xs text-gray-400 hover:text-gray-600 underline"
                      >
                        Reset to default template
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Save bar */}
        <div className="mt-8 flex items-center justify-between max-w-3xl">
          <div>
            {msg && (
              <p className={`text-sm ${msg.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
                {msg.text}
              </p>
            )}
          </div>
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? 'Saving…' : 'Save Settings'}
          </button>
        </div>
      </form>
    </div>
  )
}
