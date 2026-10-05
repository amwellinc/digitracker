// Project notification emails. Sent by the send-notification-email edge
// function, which the notifications_dispatch_email database trigger calls via
// pg_net. Projects can span up to 3 workspaces, so members are often in a
// different workspace from whoever acted and have no other way of finding out.
import type { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getPlatformSmtp } from './smtp.ts'

const APP_URL = 'https://digitracker-app.digi5y.co'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export interface ProjectNotificationInfo {
  toEmail: string
  memberName: string
  projectId: string
  projectName: string
  subject: string
  message: string
}

// Never throws — the in-app notification already exists by the time this runs.
export async function sendProjectNotificationEmail(
  admin: ReturnType<typeof createClient>,
  info: ProjectNotificationInfo,
): Promise<{ sent: boolean; error: string | null }> {
  try {
    const { smtp, error } = await getPlatformSmtp(admin)
    if (!smtp) return { sent: false, error }
    const { client, from } = smtp

    const projectUrl = `${APP_URL}/#/projects/${encodeURIComponent(info.projectId)}`

    await client.send({
      from,
      to: info.toEmail,
      subject: info.subject,
      content: 'auto',
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
          <p>Hi ${escapeHtml(info.memberName)},</p>
          <p>${escapeHtml(info.message)}</p>
          <p>Project: <strong>${escapeHtml(info.projectName)}</strong></p>
          <p><a href="${projectUrl}" style="display:inline-block;background:#7c3aed;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;">Open project</a></p>
        </div>`,
    })

    await client.close()
    return { sent: true, error: null }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('sendProjectNotificationEmail failed:', err)
    return { sent: false, error: message }
  }
}
