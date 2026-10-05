// supabase/functions/send-notification-email/index.ts
// Called only by the notifications_dispatch_email database trigger (pg_net),
// never by browsers. Deployed --no-verify-jwt; the shared secret header is
// the auth boundary.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendProjectNotificationEmail } from '../_shared/projectEmails.ts'

const SUBJECTS: Record<string, (project: string) => string> = {
  project_added:         p => `You've been added to the project "${p}" on DIGITRACKER`,
  project_task_assigned: p => `New task assigned to you in "${p}"`,
  project_task_comment:  p => `New comment on your task in "${p}"`,
  project_task_created:  p => `New task in "${p}"`,
  project_task_status:   p => `Task status changed in "${p}"`,
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const expected = Deno.env.get('NOTIFICATION_EMAIL_SECRET') ?? ''
  const provided = req.headers.get('x-notification-secret') ?? ''
  if (!expected || !safeEqual(provided, expected)) return json({ error: 'Forbidden' }, 403)

  let notificationId: unknown
  try {
    ({ notificationId } = await req.json())
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }
  if (typeof notificationId !== 'string' || !notificationId) return json({ error: 'notificationId is required' }, 400)

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const { data: n } = await admin
    .from('notifications')
    .select('type, message, project_id, users(name, email), projects(name)')
    .eq('id', notificationId)
    .maybeSingle()
  const row = n as { type: string; message: string; project_id: string | null;
    users: { name: string; email: string } | null; projects: { name: string } | null } | null
  if (!row?.users || !row.project_id || !row.projects) return json({ error: 'Notification not found or not project-scoped' }, 404)

  const subjectFor = SUBJECTS[row.type]
  if (!subjectFor) return json({ error: `Unsupported type ${row.type}` }, 400)

  const result = await sendProjectNotificationEmail(admin, {
    toEmail: row.users.email,
    memberName: row.users.name,
    projectId: row.project_id,
    projectName: row.projects.name,
    subject: subjectFor(row.projects.name),
    message: row.message,
  })
  if (!result.sent) console.error(`send-notification-email ${notificationId}: ${result.error}`)
  return json(result)
})
