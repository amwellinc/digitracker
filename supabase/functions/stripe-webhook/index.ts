// Receives Stripe webhook events, verifies the signature, records every
// event into payment_transactions (idempotent on Stripe's event id), and
// keeps sub_accounts/subscriptions status in sync for lifecycle events.
//
// Deployed with --no-verify-jwt: Stripe's servers call this directly and
// cannot supply a Supabase session JWT. The Stripe signature check below
// IS the authentication boundary for this function.
import Stripe from 'https://esm.sh/stripe@17?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// Stripe amounts are in the currency's smallest unit (cents for USD).
function toMajorUnits(amount: number | null | undefined): number | null {
  return typeof amount === 'number' ? amount / 100 : null
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const signature = req.headers.get('stripe-signature')
  if (!signature) return json({ error: 'Missing stripe-signature header' }, 400)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(supabaseUrl, serviceKey)

  const { data: settings, error: settingsErr } = await admin
    .from('stripe_settings')
    .select('stripe_secret_key, stripe_webhook_secret')
    .limit(1)
    .maybeSingle()

  if (settingsErr || !settings?.stripe_secret_key || !settings?.stripe_webhook_secret) {
    console.error('stripe-webhook: Stripe is not configured in stripe_settings')
    return json({ error: 'Stripe is not configured' }, 500)
  }

  const stripe = new Stripe(settings.stripe_secret_key, { apiVersion: '2024-06-20' })

  const rawBody = await req.text()
  let event: Stripe.Event
  try {
    // constructEventAsync (not constructEvent) — Deno's crypto API is async-only.
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, settings.stripe_webhook_secret)
  } catch (err) {
    console.error('stripe-webhook: signature verification failed', err)
    return json({ error: 'Invalid signature' }, 400)
  }

  // Idempotency: Stripe redelivers events on any non-2xx response or timeout.
  // A unique constraint on stripe_event_id makes re-processing a no-op.
  const alreadySeen = await admin
    .from('payment_transactions')
    .select('id')
    .eq('stripe_event_id', event.id)
    .maybeSingle()
  if (alreadySeen.data) return json({ received: true, duplicate: true })

  async function resolveSubAccount(stripeCustomerId: string | null): Promise<string | null> {
    if (!stripeCustomerId) return null
    const { data } = await admin
      .from('sub_accounts')
      .select('code')
      .eq('stripe_customer_id', stripeCustomerId)
      .maybeSingle()
    return data?.code ?? null
  }

  async function recordTransaction(row: {
    sub_account: string | null
    stripe_customer_id: string | null
    stripe_invoice_id: string | null
    status: 'succeeded' | 'failed' | 'pending' | 'refunded'
    amount: number | null
    currency: string | null
    plan?: string | null
    billing_cycle?: string | null
    failure_reason?: string | null
  }) {
    const { error } = await admin.from('payment_transactions').insert({
      stripe_event_id: event.id,
      event_type: event.type,
      raw_event: event as unknown as Record<string, unknown>,
      ...row,
    })
    // 23505 = unique_violation. Two near-simultaneous Stripe redeliveries can
    // both pass the earlier "already seen?" check — the unique constraint on
    // stripe_event_id is the real guarantee; losing this race is expected and
    // means the event is already recorded, not a real failure.
    if (error && error.code !== '23505') {
      console.error('stripe-webhook: failed to record transaction', error)
    }
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session
      const subAccount = session.client_reference_id ?? null
      const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id ?? null

      if (subAccount && customerId) {
        await admin.from('sub_accounts').update({ stripe_customer_id: customerId, status: 'active' }).eq('code', subAccount)
      }

      await recordTransaction({
        sub_account: subAccount,
        stripe_customer_id: customerId,
        stripe_invoice_id: null,
        status: 'succeeded',
        amount: toMajorUnits(session.amount_total),
        currency: session.currency,
      })
      break
    }

    case 'invoice.payment_succeeded': {
      const invoice = event.data.object as Stripe.Invoice
      const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id ?? null
      const subAccount = await resolveSubAccount(customerId)

      await recordTransaction({
        sub_account: subAccount,
        stripe_customer_id: customerId,
        stripe_invoice_id: invoice.id,
        status: 'succeeded',
        amount: toMajorUnits(invoice.amount_paid),
        currency: invoice.currency,
      })
      break
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice
      const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id ?? null
      const subAccount = await resolveSubAccount(customerId)

      await recordTransaction({
        sub_account: subAccount,
        stripe_customer_id: customerId,
        stripe_invoice_id: invoice.id,
        status: 'failed',
        amount: toMajorUnits(invoice.amount_due),
        currency: invoice.currency,
        failure_reason: invoice.last_finalization_error?.message ?? 'Payment failed',
      })
      break
    }

    case 'customer.subscription.updated': {
      const sub = event.data.object as Stripe.Subscription
      const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id ?? null
      const subAccount = await resolveSubAccount(customerId)

      await recordTransaction({
        sub_account: subAccount,
        stripe_customer_id: customerId,
        stripe_invoice_id: null,
        status: 'succeeded',
        amount: null,
        currency: null,
      })
      break
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription
      const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id ?? null
      const subAccount = await resolveSubAccount(customerId)

      if (subAccount) {
        await admin.from('sub_accounts').update({ status: 'cancelled' }).eq('code', subAccount)
        await admin.from('subscriptions').update({ status: 'cancelled' }).eq('sub_account', subAccount)
      }

      await recordTransaction({
        sub_account: subAccount,
        stripe_customer_id: customerId,
        stripe_invoice_id: null,
        status: 'succeeded',
        amount: null,
        currency: null,
      })
      break
    }

    default:
      // Record anything else too, so nothing Stripe sends is silently dropped —
      // just without special handling beyond the audit trail.
      await recordTransaction({
        sub_account: null,
        stripe_customer_id: null,
        stripe_invoice_id: null,
        status: 'pending',
        amount: null,
        currency: null,
      })
  }

  return json({ received: true })
})
