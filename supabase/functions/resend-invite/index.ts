// Super-Admin recovery tool for the invite-email-failure incident: lets a
// Super-Admin re-send a stuck customer's account-activation invite without
// needing database access. Built after a paid-plan signup left a real
// customer with an active sub_account/subscription/Auth user but no invite
// ever delivered (see provision-subscription's header comment for the full
// incident). Same admin-edge-function auth pattern as ghl-disconnect /
// admin-set-suspension: verify the caller's session, then check their role
// before doing anything privileged.
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
  subAccountCode: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'Missing authorization header' }, 401)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey     = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: { user: callerAuthUser }, error: callerErr } = await callerClient.auth.getUser()
  if (callerErr || !callerAuthUser?.email) return json({ error: 'Invalid session' }, 401)

  const admin = createClient(supabaseUrl, serviceKey)

  const { data: callerRow } = await admin
    .from('users')
    .select('role')
    .ilike('email', callerAuthUser.email)
    .maybeSingle()

  if (!callerRow || callerRow.role !== 'Super-Admin') {
    return json({ error: 'Only Super-Admins can resend an invite.' }, 403)
  }

  let body: RequestBody
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }
  const subAccountCode = (body.subAccountCode ?? '').trim()
  if (!subAccountCode) return json({ error: 'subAccountCode is required.' }, 400)

  const { data: subAccount } = await admin
    .from('sub_accounts')
    .select('code, company_name, admin_email, plan, trial_starts_at, trial_ends_at')
    .eq('code', subAccountCode)
    .maybeSingle()
  if (!subAccount) return json({ error: 'No sub-account found with that code.' }, 404)
  if (!subAccount.admin_email) return json({ error: 'This sub-account has no admin email on file.' }, 400)

  const { data: adminUser } = await admin
    .from('users')
    .select('id, name')
    .eq('sub_account', subAccountCode)
    .eq('role', 'Admin')
    .maybeSingle()

  const { data: subscription } = await admin
    .from('subscriptions')
    .select('billing_cycle')
    .eq('sub_account', subAccountCode)
    .maybeSingle()

  const { data: planCfg } = await admin
    .from('plan_configs')
    .select('name, price_monthly, price_annual')
    .eq('id', subAccount.plan)
    .maybeSingle()

  const billingCycle = subscription?.billing_cycle === 'annual' ? 'annual' : 'monthly'
  const priceForEmail = subAccount.plan === 'free' || !planCfg
    ? 'Free'
    : `${(billingCycle === 'annual' ? planCfg.price_annual : planCfg.price_monthly).toFixed(2)} / ${billingCycle === 'annual' ? 'year' : 'month'}`

  const origin = req.headers.get('origin') || 'https://digitracker-app.digi5y.co'
  const redirectTo = `${origin}/auth/reset`

  // The Auth user already exists from the original signup — generateLink
  // with type 'invite' fails for an existing user, so use 'recovery' to get
  // a fresh action_link that still lands them on the same set-password flow.
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'recovery',
    email: subAccount.admin_email,
    options: { redirectTo },
  })
  if (linkErr || !linkData?.properties?.action_link) {
    return json({ error: linkErr?.message ?? 'Failed to generate a fresh invite link.' }, 500)
  }
  const inviteLink = linkData.properties.action_link

  const primary = await sendInviteAndInvoiceEmail(admin, {
    companyName: subAccount.company_name,
    adminName: adminUser?.name || subAccount.company_name,
    adminEmail: subAccount.admin_email,
    planName: planCfg?.name ?? subAccount.plan,
    priceForEmail,
    trialStartsAt: subAccount.trial_starts_at,
    trialEndsAt: subAccount.trial_ends_at,
    inviteLink,
  })

  let fallbackError: string | null = null
  if (!primary.sent) {
    const { error: fallbackErr } = await admin.auth.admin.inviteUserByEmail(subAccount.admin_email, { redirectTo })
    fallbackError = fallbackErr?.message ?? null
  }
  const emailDelivered = primary.sent || !fallbackError

  return json({
    success: true,
    emailDelivered,
    inviteLink,
    error: emailDelivered
      ? null
      : `${primary.error ?? 'unknown'}${fallbackError ? `; fallback also failed: ${fallbackError}` : ''}`,
  })
})
