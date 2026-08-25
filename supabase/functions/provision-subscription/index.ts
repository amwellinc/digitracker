// Self-service subscription signup. Public/unauthenticated — called from the
// /subscribe page before the visitor has any account. Everything here runs
// under the service-role key because there is no caller identity yet.
//
// Flow: validate → generate an invite link for a new Auth user (no password
// collected on the form — the customer sets one after clicking the invite)
// → create sub_accounts / users / subscriptions rows → notify Super-Admins
// (in-app + best-effort email) → email the customer a single branded
// message that doubles as their invoice (product, plan, website) and their
// account invite → for paid plans, create a Stripe Customer + Checkout
// Session and hand the URL back for the browser to redirect to. Free plans
// skip Stripe entirely and are active immediately.
//
// A prior version of this function had the customer set a password
// directly on the signup form and created the Auth account immediately
// with email_confirm:true — no invite step, and the only confirmation was
// whatever the "Thank You" page happened to say. A Free-plan signup
// reported getting no usable confirmation of any kind: no account access,
// no invite. This version never depends on a single channel — the invite
// link is generated server-side and embedded in our own branded email; if
// that SMTP send fails or isn't configured, Supabase's own default invite
// email is sent as a fallback so the customer always has a way in.
//
// A paid-plan signup then reported the same symptom despite that fallback:
// only Stripe's own payment receipt arrived, no DIGITRACKER invite. The
// fallback's error was being discarded with .catch(() => {}) — there was no
// way to tell whether it ran, let alone why it failed, and if both channels
// are actually broken (e.g. Supabase's own email sending isn't configured
// either) the account is created with genuinely no way for the customer to
// get in. Now: the fallback's outcome is captured, not discarded, and
// whichever result comes back is included in the Super-Admin notification —
// including the raw invite link — so a failure is visible immediately and
// recoverable via the resend-invite function without needing to guess.
//
// stripe-webhook already handles checkout.session.completed by UPDATING
// sub_accounts (via client_reference_id) rather than inserting — this
// function is what makes that assumption true: the row always exists first.
import Stripe from 'https://esm.sh/stripe@17?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendInviteAndInvoiceEmail } from '../_shared/inviteEmail.ts'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  })
}

interface RequestBody {
  companyName: string
  adminName: string
  adminEmail: string
  plan: 'free' | 'basic' | 'business' | 'professional'
  billingCycle: 'monthly' | 'annual'
  currencyCode: string
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function slugCode(name: string): string {
  const base = name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
  return base || 'COMPANY'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  let body: RequestBody
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  const companyName   = (body.companyName ?? '').trim()
  const adminName     = (body.adminName ?? '').trim()
  const adminEmail    = (body.adminEmail ?? '').toLowerCase().trim()
  const plan          = body.plan
  const billingCycle  = body.billingCycle === 'annual' ? 'annual' : 'monthly'
  const currencyCode  = (body.currencyCode || 'USD').toUpperCase()

  if (!companyName)                              return json({ error: 'Company name is required.' }, 400)
  if (!adminEmail || !EMAIL_RE.test(adminEmail))  return json({ error: 'A valid work email is required.' }, 400)
  if (!['free', 'basic', 'business', 'professional'].includes(plan)) {
    return json({ error: 'Invalid plan selected.' }, 400)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(supabaseUrl, serviceKey)

  // Email must be globally unique — a pre-check gives a clearer message
  // than an auth error surfaced deep in the generateLink call.
  const { data: existing } = await admin.from('users').select('id').ilike('email', adminEmail).maybeSingle()
  if (existing) return json({ error: 'An account with this email already exists. Try signing in instead.' }, 409)

  const { data: planCfg } = await admin
    .from('plan_configs')
    .select('*')
    .eq('id', plan)
    .eq('is_active', true)
    .maybeSingle()
  if (!planCfg) return json({ error: 'That plan is not currently available.' }, 400)

  const { data: stripeSettings } = await admin
    .from('stripe_settings')
    .select('stripe_secret_key, trial_days')
    .limit(1)
    .maybeSingle()

  if (plan !== 'free' && !stripeSettings?.stripe_secret_key) {
    return json({ error: 'Online payment is not available right now. Please contact support.' }, 503)
  }

  const trialDays: number = plan !== 'free' ? (stripeSettings?.trial_days ?? 0) : 0
  const initialStatus = plan === 'free' ? 'active' : (trialDays > 0 ? 'trialing' : 'active')
  const nowIso = new Date().toISOString()
  const trialStartsAt = trialDays > 0 ? nowIso : null
  const trialEndsAt = trialDays > 0 ? new Date(Date.now() + trialDays * 86_400_000).toISOString() : null

  const origin = req.headers.get('origin') || 'https://digitracker-app.digi5y.co'
  const redirectTo = `${origin}/auth/reset`

  // ── Generate the invite link — creates the Auth user but does NOT send
  //    Supabase's own email, so our branded invoice/invite email below is
  //    the only one the customer sees (with inviteUserByEmail as fallback
  //    if that send fails). Everything else rolls back if this fails.
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'invite',
    email: adminEmail,
    options: { redirectTo },
  })
  if (linkErr || !linkData?.user) {
    return json({ error: linkErr?.message ?? 'Failed to create your account.' }, 400)
  }
  const authUserId = linkData.user.id
  const inviteLink = linkData.properties?.action_link ?? null

  async function rollback(reason: string, status = 500) {
    await admin.from('subscriptions').delete().eq('sub_account', code).then(() => {})
    await admin.from('users').delete().eq('id', authUserId).then(() => {})
    await admin.from('sub_accounts').delete().eq('code', code).then(() => {})
    await admin.auth.admin.deleteUser(authUserId).catch(() => {})
    return json({ error: reason }, status)
  }

  // ── sub_accounts — retry with a random suffix on a code collision ───────
  let code = slugCode(companyName)
  let saError: { code?: string; message: string } | null = null
  for (let attempt = 0; attempt < 5; attempt++) {
    const tryCode = attempt === 0 ? code : `${slugCode(companyName)}${Math.floor(100 + Math.random() * 900)}`
    const { error } = await admin.from('sub_accounts').insert({
      code: tryCode,
      company_name: companyName,
      admin_email: adminEmail,
      plan,
      seats: planCfg.max_seats,
      status: initialStatus,
      trial_starts_at: trialStartsAt,
      trial_ends_at: trialEndsAt,
    })
    if (!error) { code = tryCode; saError = null; break }
    saError = error
    if (error.code !== '23505') break
  }
  if (saError) {
    await admin.auth.admin.deleteUser(authUserId).catch(() => {})
    return json({ error: saError.message }, 500)
  }

  // ── First user (account-admin) for the new sub-account ──────────────────
  const { error: userErr } = await admin.from('users').insert({
    id:                authUserId,
    email:             adminEmail,
    name:              adminName || companyName,
    role:              'Admin',
    sub_account:       code,
    annual_leave:      14,
    time_off:          40,
    reporting_time_in: '09:00',
    reporting_time_out: '18:00',
    country:           'SG',
  })
  if (userErr) return await rollback(userErr.message)

  await admin.from('subscriptions').insert({
    sub_account:   code,
    plan,
    seats:         planCfg.max_seats,
    status:        initialStatus,
    billing_cycle: billingCycle,
    company_name:  companyName,
  })

  const priceForEmail = plan === 'free'
    ? 'Free'
    : `${currencyCode} ${(billingCycle === 'annual' ? planCfg.price_annual : planCfg.price_monthly).toFixed(2)} / ${billingCycle === 'annual' ? 'year' : 'month'}`

  const primary = await sendInviteAndInvoiceEmail(admin, {
    companyName, adminName: adminName || companyName, adminEmail,
    planName: planCfg.name, priceForEmail,
    trialStartsAt, trialEndsAt,
    inviteLink,
  })

  // Our branded email is the primary channel; if it didn't go out (SMTP not
  // configured or failed), fall back to Supabase's own default invite email
  // so the customer is never left with zero way to activate their account.
  // The fallback's own outcome is captured too, not discarded — if BOTH
  // channels fail, that has to be visible somewhere, not silent.
  let fallbackError: string | null = null
  if (!primary.sent) {
    const { error: fallbackErr } = await admin.auth.admin.inviteUserByEmail(adminEmail, { redirectTo })
    fallbackError = fallbackErr?.message ?? null
  }
  const emailDelivered = primary.sent || !fallbackError

  // ── Notify Super-Admins — in-app is guaranteed, email is best-effort ────
  // Always includes the raw invite link and the failure reason(s) when
  // delivery didn't succeed, so a Super-Admin can act immediately (forward
  // the link manually, or use Settings > Subscriptions > Resend Invite)
  // instead of the customer being silently stuck with an account they can't
  // reach — exactly what happened before this was added.
  const notifyMessage = emailDelivered
    ? `New ${planCfg.name} plan signup: ${companyName} (${adminEmail}).`
    : `New ${planCfg.name} plan signup: ${companyName} (${adminEmail}). ⚠️ Invite email failed to send ` +
      `(${primary.error ?? 'unknown'}${fallbackError ? `; fallback also failed: ${fallbackError}` : ''}). ` +
      `Invite link: ${inviteLink ?? 'unavailable'}`

  const { data: superAdmins } = await admin
    .from('users')
    .select('id, email, name')
    .eq('role', 'Super-Admin')
    .eq('status', 'active')

  if (superAdmins && superAdmins.length > 0) {
    await admin.from('notifications').insert(
      superAdmins.map((s: { id: string }) => ({ user_id: s.id, type: 'new_subscription', message: notifyMessage, read: false }))
    )
  }

  const responsePayload = {
    success: true,
    code,
    planName: planCfg.name,
    isFree: plan === 'free',
    trialStartsAt,
    trialEndsAt,
  }

  // ── Free plan: done, no payment step ─────────────────────────────────────
  if (plan === 'free') {
    return json(responsePayload)
  }

  // ── Paid plan: Stripe customer + hosted Checkout Session ────────────────
  try {
    const stripe = new Stripe(stripeSettings!.stripe_secret_key!, { apiVersion: '2024-06-20' })

    const customer = await stripe.customers.create({
      email: adminEmail,
      name: companyName,
      metadata: { sub_account: code },
    })
    await admin.from('sub_accounts').update({ stripe_customer_id: customer.id }).eq('code', code)

    let unitAmount = Math.round((billingCycle === 'annual' ? planCfg.price_annual : planCfg.price_monthly) * 100)
    const { data: pricing } = await admin
      .from('plan_currency_pricing')
      .select('price_monthly, price_annual')
      .eq('plan_id', plan)
      .eq('currency_code', currencyCode)
      .maybeSingle()
    if (pricing) {
      unitAmount = Math.round((billingCycle === 'annual' ? pricing.price_annual : pricing.price_monthly) * 100)
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customer.id,
      client_reference_id: code,
      line_items: [{
        price_data: {
          currency: currencyCode.toLowerCase(),
          product_data: { name: `DIGITRACKER — ${planCfg.name} (${billingCycle === 'annual' ? 'Annual' : 'Monthly'})` },
          unit_amount: unitAmount,
          recurring: { interval: billingCycle === 'annual' ? 'year' : 'month' },
        },
        quantity: 1,
      }],
      subscription_data: trialDays > 0 ? { trial_period_days: trialDays } : undefined,
      success_url: `${origin}/#/subscribe/thank-you?code=${code}&plan=${plan}&planName=${encodeURIComponent(planCfg.name)}${trialStartsAt ? `&trialStart=${trialStartsAt}` : ''}${trialEndsAt ? `&trialEnd=${trialEndsAt}` : ''}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/#/subscribe?cancelled=true`,
    })

    return json({ ...responsePayload, checkoutUrl: session.url })
  } catch (err) {
    return await rollback(err instanceof Error ? err.message : 'Failed to start checkout.')
  }
})
