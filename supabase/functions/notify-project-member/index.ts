// Emails someone who was just added to a project. Called by the app right
// after a successful add_project_member RPC. The in-app notification is
// written by that RPC itself (migration 060); this function only covers the
// email, which needs SMTP credentials the browser must never see.
//
// Authorization mirrors add_project_member: the caller must be a Super-Admin,
// or an Admin/Manager who is a member of the project. The target must
// already be a member, so this can't be used to email arbitrary users.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendProjectAddedEmail } from '../_shared/projectEmails.ts'

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
  projectId?: unknown
  userId?: unknown
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

  let body: RequestBody
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }
  const { projectId, userId } = body
  if (typeof projectId !== 'string' || !projectId) return json({ error: 'projectId is required' }, 400)
  if (typeof userId !== 'string' || !userId) return json({ error: 'userId is required' }, 400)

  // Service-role client — bypasses RLS deliberately; the checks below ARE
  // the security boundary for this function.
  const admin = createClient(supabaseUrl, serviceKey)

  const { data: callerRow } = await admin
    .from('users')
    .select('id, name, role')
    .ilike('email', callerAuthUser.email)
    .eq('status', 'active')
    .maybeSingle()
  if (!callerRow) return json({ error: 'Caller not found' }, 403)

  const { data: project } = await admin
    .from('projects')
    .select('id, name')
    .eq('id', projectId)
    .maybeSingle()
  if (!project) return json({ error: 'Project not found' }, 404)

  if (callerRow.role !== 'Super-Admin') {
    if (!['Admin', 'Manager'].includes(callerRow.role as string)) {
      return json({ error: 'Not allowed to notify project members' }, 403)
    }
    const { data: callerMembership } = await admin
      .from('project_members')
      .select('user_id')
      .eq('project_id', projectId)
      .eq('user_id', callerRow.id)
      .maybeSingle()
    if (!callerMembership) return json({ error: 'You must be a member of this project' }, 403)
  }

  const { data: targetMembership } = await admin
    .from('project_members')
    .select('user_id, users(name, email)')
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .maybeSingle()
  const target = (targetMembership as { users: { name: string; email: string } | null } | null)?.users
  if (!target) return json({ error: 'That user is not a member of this project' }, 404)

  const result = await sendProjectAddedEmail(admin, {
    toEmail: target.email,
    memberName: target.name,
    projectId: project.id as string,
    projectName: project.name as string,
    addedByName: callerRow.name as string,
  })
  return json(result)
})
