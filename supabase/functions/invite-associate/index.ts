// Invites an outside collaborator ("associate") into a project. See
// docs/superpowers/specs/2026-10-05-project-associates-design.md §2.2.
// Authorization: Super-Admin, or an Admin who is a member of the project.
//
// Associates are not paying customers — they must never see the plan/
// pricing signup flow. Two bugs made that happen in practice: (1) this used
// to sign them in via a plain signInWithOtp() redirecting to the bare app
// origin, which only HashRouter-bridges /auth/reset and /auth/magic-link —
// landing on the bare root left them unauthenticated with "Create an
// account" as the only visible next step, straight into the paid-plan
// signup page; (2) even if the redirect were fixed, OTP signs a person
// straight in with no password-setup step, where the whole point here is an
// easy "set your password" flow. Using Supabase's invite/recovery admin API
// instead sends them through the exact same /auth/reset bridge ->
// ResetPasswordPage "set your password" form already used for staff
// invites, then lands them in AssociateLayout (their only view) with no
// plan step ever rendered.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendAssociateInviteEmail } from '../_shared/accountEmails.ts'

const APP_URL = 'https://digitracker-app.digi5y.co'
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Escape LIKE wildcards so ilike() behaves as a case-insensitive equality.
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

  let body: { projectId?: unknown; email?: unknown; name?: unknown }
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON body' }, 400) }
  const projectId = typeof body.projectId === 'string' ? body.projectId : ''
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!projectId) return json({ error: 'projectId is required' }, 400)
  if (!EMAIL_RE.test(email)) return json({ error: 'A valid email address is required' }, 400)
  if (!name) return json({ error: 'Name is required' }, 400)

  // Service-role client — the checks below are the security boundary.
  const admin = createClient(supabaseUrl, serviceKey)

  const { data: caller } = await admin.from('users').select('id, name, role')
    .ilike('email', callerAuth.email).eq('status', 'active').maybeSingle()
  if (!caller) return json({ error: 'Caller not found' }, 403)

  const { data: project } = await admin.from('projects').select('id, name').eq('id', projectId).maybeSingle()
  if (!project) return json({ error: 'Project not found' }, 404)

  if (caller.role !== 'Super-Admin') {
    if (caller.role !== 'Admin') return json({ error: 'Only Super-Admins and Admins can invite associates' }, 403)
    const { data: m } = await admin.from('project_members').select('user_id')
      .eq('project_id', projectId).eq('user_id', caller.id).maybeSingle()
    if (!m) return json({ error: 'You must be a member of this project to invite associates' }, 403)
  }

  const { data: existing, error: lookupErr } = await admin.from('users').select('id, role, status')
    .ilike('email', escapeLike(email)).maybeSingle()
  if (lookupErr) return json({ error: `Could not look up user: ${lookupErr.message}` }, 500)
  if (existing && existing.role !== 'Associate') {
    return json({ error: 'This email belongs to a workspace user — add them as a normal member instead.' }, 409)
  }

  let userId: string
  let createdHere = false
  let status: 'invited' | 'added' | 'already_member' = 'added'
  if (!existing) {
    const { data: created, error: insErr } = await admin.from('users')
      .insert({ email, name, role: 'Associate', sub_account: 'ASSOCIATE', status: 'active' })
      .select('id').single()
    if (insErr || !created) return json({ error: `Could not create associate: ${insErr?.message}` }, 500)
    userId = created.id as string
    status = 'invited'
    createdHere = true
  } else {
    userId = existing.id as string
    if (existing.status !== 'active') {
      await admin.from('users').update({ status: 'active' }).eq('id', userId)
    }
  }

  const { data: already } = await admin.from('project_members').select('user_id')
    .eq('project_id', projectId).eq('user_id', userId).maybeSingle()
  if (already) {
    status = status === 'invited' ? 'invited' : 'already_member'
  } else {
    const { error: memErr } = await admin.from('project_members').insert({ project_id: projectId, user_id: userId })
    if (memErr) {
      // Don't strand a brand-new associate who could never be re-invited properly.
      if (createdHere) await admin.from('users').delete().eq('id', userId)
      return json({ error: `Could not add to project: ${memErr.message}` }, 500)
    }
    // Same text as add_project_member; the dispatch trigger emails it.
    const { error: notifErr } = await admin.from('notifications').insert({
      user_id: userId, type: 'project_added', read: false, project_id: projectId,
      message: `${caller.name} added you to the project "${project.name}" — find it in your sidebar as PROJECTS-${project.name}.`,
    })
    if (notifErr) console.error('invite-associate: notification insert failed', notifErr.message)
  }

  // 'already_member' re-invite doubles as a resend of the password-setup link.
  if (status === 'invited') {
    // Brand-new associate: inviteUserByEmail both creates the Supabase Auth
    // user and sends Supabase's own invite email, landing them on
    // /auth/reset (already bridged) to set a password.
    const { error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${APP_URL}/auth/reset`,
    })
    if (inviteErr) return json({ status, error: `Added, but the invite email failed: ${inviteErr.message}` })
  } else if (status === 'already_member') {
    // Auth user already exists from their first invite — inviteUserByEmail/
    // generateLink(type:'invite') both fail for an existing user, so get a
    // fresh recovery link instead (same fallback resend-invite uses) and
    // deliver it ourselves with a plain, plan-free email.
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: { redirectTo: `${APP_URL}/auth/reset` },
    })
    if (linkErr || !linkData?.properties?.action_link) {
      return json({ status, error: `Added, but could not generate a sign-in link: ${linkErr?.message ?? 'unknown'}` })
    }
    const sent = await sendAssociateInviteEmail(admin, {
      associateName: name,
      associateEmail: email,
      inviterName: caller.name,
      projectName: project.name,
      inviteLink: linkData.properties.action_link,
    })
    if (!sent.sent) return json({ status, error: `Added, but the sign-in email failed: ${sent.error}` })
  }

  return json({ status })
})
