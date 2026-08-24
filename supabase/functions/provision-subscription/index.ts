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
// stripe-webhook already handles checkout.session.completed by UPDATING
// sub_accounts (via client_reference_id) rather than inserting — this
// function is what makes that assumption true: the row always exists first.
import Stripe from 'https://esm.sh/stripe@17?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const PRODUCT_WEBSITE = 'www.digitracker.co'

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

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
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

  // ── Notify Super-Admins — in-app is guaranteed, email is best-effort ────
  const notifyMessage = `New ${planCfg.name} plan signup: ${companyName} (${adminEmail}).`
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

  const priceForEmail = plan === 'free'
    ? 'Free'
    : `${currencyCode} ${(billingCycle === 'annual' ? planCfg.price_annual : planCfg.price_monthly).toFixed(2)} / ${billingCycle === 'annual' ? 'year' : 'month'}`

  const emailSent = await sendInviteAndInvoiceEmail(admin, {
    companyName, adminName: adminName || companyName, adminEmail,
    planName: planCfg.name, priceForEmail,
    trialStartsAt, trialEndsAt,
    inviteLink,
    superAdmins: (superAdmins ?? []) as { email: string; name: string }[],
  })

  // Our branded email is the primary channel; if it didn't go out (SMTP not
  // configured or failed), fall back to Supabase's own default invite email
  // so the customer is never left with zero way to activate their account.
  if (!emailSent) {
    await admin.auth.admin.inviteUserByEmail(adminEmail, { redirectTo }).catch(() => {})
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

// Best-effort — a missing/invalid SMTP configuration must never fail signup.
// Returns whether the customer's invite/invoice email actually sent, so the
// caller can fall back to Supabase's own default invite email if not.
async function sendInviteAndInvoiceEmail(
  admin: ReturnType<typeof createClient>,
  info: {
    companyName: string; adminName: string; adminEmail: string
    planName: string; priceForEmail: string
    trialStartsAt: string | null; trialEndsAt: string | null
    inviteLink: string | null
    superAdmins: { email: string; name: string }[]
  },
): Promise<boolean> {
  try {
    const { data: platform } = await admin
      .from('platform_settings')
      .select('smtp_host, smtp_port, smtp_secure, smtp_user, smtp_pass, from_email, from_name')
      .limit(1)
      .maybeSingle()

    if (!platform?.smtp_host || !platform.smtp_user || !platform.smtp_pass || !platform.from_email) return false

    const client = new SMTPClient({
      connection: {
        hostname: platform.smtp_host,
        port: platform.smtp_port,
        tls: platform.smtp_secure,
        auth: { username: platform.smtp_user, password: platform.smtp_pass },
      },
    })
    const from = `${platform.from_name || 'DIGITRACKER'} <${platform.from_email}>`

    const trialRow = info.trialStartsAt && info.trialEndsAt
      ? `<tr><td style="padding:6px 0;color:#64748b;">Trial period</td><td style="padding:6px 0;text-align:right;font-weight:600;">${fmtDate(info.trialStartsAt)} – ${fmtDate(info.trialEndsAt)}</td></tr>`
      : ''

    const inviteButton = info.inviteLink
      ? `<p style="text-align:center;margin:28px 0;">
           <a href="${info.inviteLink}" style="background:#6D28D9;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;display:inline-block;">Activate Your Account →</a>
         </p>`
      : ''

    await client.send({
      from,
      to: info.adminEmail,
      subject: `Your DIGITRACKER order — ${info.planName} plan`,
      content: 'auto',
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
          <p>Hi ${info.adminName},</p>
          <p>Thanks for signing up for <strong>DIGITRACKER</strong> — here's your order summary and account invite.</p>

          <table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:14px;">
            <tr><td style="padding:6px 0;color:#64748b;">Product</td><td style="padding:6px 0;text-align:right;font-weight:600;">DIGITRACKER</td></tr>
            <tr><td style="padding:6px 0;color:#64748b;">Plan</td><td style="padding:6px 0;text-align:right;font-weight:600;">${info.planName}</td></tr>
            <tr><td style="padding:6px 0;color:#64748b;">Company</td><td style="padding:6px 0;text-align:right;font-weight:600;">${info.companyName}</td></tr>
            <tr><td style="padding:6px 0;color:#64748b;">Price</td><td style="padding:6px 0;text-align:right;font-weight:600;">${info.priceForEmail}</td></tr>
            ${trialRow}
          </table>

          ${inviteButton}

          <p style="font-size:13px;color:#64748b;">Click the button above to activate your account and set your password. If the button doesn't work, copy and paste this link:<br>
          <a href="${info.inviteLink ?? ''}">${info.inviteLink ?? ''}</a></p>

          <p style="font-size:13px;color:#94a3b8;margin-top:24px;">${PRODUCT_WEBSITE}</p>
        </div>`,
    })

    for (const sa of info.superAdmins) {
      await client.send({
        from,
        to: sa.email,
        subject: `New signup: ${info.companyName} (${info.planName})`,
        content: 'auto',
        html: `<p>Hi ${sa.name},</p>
          <p><strong>${info.companyName}</strong> (${info.adminEmail}) just signed up for the <strong>${info.planName}</strong> plan.</p>`,
      })
    }

    await client.close()
    return true
  } catch (err) {
    console.error('provision-subscription: notification email failed', err)
    return false
  }
}
