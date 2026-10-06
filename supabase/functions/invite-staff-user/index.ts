// Invites (or re-invites) a Staff/Manager/Admin user into the caller's own,
// already-existing sub-account. These are not new companies signing up for
// a plan -- they're being handed access to one that already exists -- so
// this must never touch plan/pricing/signup machinery.
//
// Replaces four client-side signInWithOtp() calls in UsersTab.tsx (Add
// User, email-change re-invite, the per-row Invite button, Invite All) that
// all redirected to the bare app origin. HashRouter only bridges two
// dedicated paths before React boots -- /auth/reset and /auth/magic-link
// (see index.html / public/404.html) -- so a bare-origin redirect left the
// invited person unauthenticated on "/", where the only visible next step
// was LoginPage's "Create an account" link straight into the paid-plan
// signup page. Same root cause already fixed once for the Sign-In page's
// own magic-link option (AuthContext.signIn) and once for Project
// Associate invites (invite-associate) -- this generalizes that same fix
// (Supabase's invite/recovery admin API, redirecting to /auth/reset, the
// same bridge + ResetPasswordPage "set your password" form) to ordinary
// staff invites.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendStaffInviteEmail } from '../_shared/accountEmails.ts'

const APP_URL = 'https://digitracker-app.digi5y.co'
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function escapeLike(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'Missing authorization header' }, 401)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey     = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } })
  const { data: { user: callerAuth }, error: callerErr } = await callerClient.auth.getUser()
  if (callerErr || !callerAuth?.email) return json({ error: 'Invalid session' }, 401)

  let body: { email?: unknown }
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON body' }, 400) }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!EMAIL_RE.test(email)) return json({ error: 'A valid email address is required' }, 400)

  // Service-role client -- the checks below are the security boundary.
  const admin = createClient(supabaseUrl, serviceKey)

  const { data: caller } = await admin.from('users').select('name, role, sub_account')
    .ilike('email', callerAuth.email).eq('status', 'active').maybeSingle()
  if (!caller) return json({ error: 'Caller not found' }, 403)
  if (!['Admin', 'Super-Admin'].includes(caller.role as string)) {
    return json({ error: 'Only Admins and Super-Admins can invite users' }, 403)
  }

  const { data: target, error: targetErr } = await admin.from('users').select('id, name, sub_account')
    .ilike('email', escapeLike(email)).maybeSingle()
  if (targetErr) return json({ error: `Could not look up user: ${targetErr.message}` }, 500)
  if (!target) return json({ error: 'No user with that email exists yet.' }, 404)
  if (caller.role !== 'Super-Admin' && target.sub_account !== caller.sub_account) {
    return json({ error: 'You can only invite users in your own workspace.' }, 403)
  }

  const redirectTo = `${APP_URL}/auth/reset`

  // Brand-new invite: creates the Auth user and sends Supabase's own invite
  // email. Fails if an Auth user already exists for this email -- which,
  // after any earlier signInWithOtp() call (that auto-provisions one even
  // if the link was never clicked), is the common case for a re-invite.
  const { error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo })
  if (!inviteErr) return json({ success: true })

  // Fall back to a fresh recovery link, delivered through a plain,
  // plan-free email -- same fallback resend-invite already uses for its
  // own re-invite case.
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: { redirectTo },
  })
  if (linkErr || !linkData?.properties?.action_link) {
    return json({ error: linkErr?.message ?? inviteErr.message ?? 'Failed to generate a sign-in link.' }, 500)
  }

  const { data: subAccount } = await admin.from('sub_accounts').select('company_name')
    .eq('code', target.sub_account).maybeSingle()

  const sent = await sendStaffInviteEmail(admin, {
    staffName: target.name,
    staffEmail: email,
    companyName: subAccount?.company_name || target.sub_account,
    inviteLink: linkData.properties.action_link,
  })
  if (!sent.sent) return json({ error: `Could not send the invite email: ${sent.error}` }, 500)

  return json({ success: true })
})
