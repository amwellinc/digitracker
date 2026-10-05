// "You've been added to a project" email. Projects can span up to 3
// workspaces, so the person being added is often in a different workspace
// from whoever added them and has no other way of finding out — the sidebar
// entry only appears once they next open the app.
import type { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getPlatformSmtp } from './smtp.ts'

const APP_URL = 'https://digitracker-app.digi5y.co'

export interface ProjectAddedInfo {
  toEmail: string
  memberName: string
  projectId: string
  projectName: string
  addedByName: string
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Never throws — membership has already been granted by the time this runs.
export async function sendProjectAddedEmail(
  admin: ReturnType<typeof createClient>,
  info: ProjectAddedInfo,
): Promise<{ sent: boolean; error: string | null }> {
  try {
    const { smtp, error } = await getPlatformSmtp(admin)
    if (!smtp) return { sent: false, error }
    const { client, from } = smtp

    const projectUrl = `${APP_URL}/#/projects/${encodeURIComponent(info.projectId)}`
    const project = escapeHtml(info.projectName)

    await client.send({
      from,
      to: info.toEmail,
      subject: `You've been added to the project "${info.projectName}" on DIGITRACKER`,
      content: 'auto',
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
          <p>Hi ${escapeHtml(info.memberName)},</p>
          <p><strong>${escapeHtml(info.addedByName)}</strong> added you to the project
          <strong>${project}</strong> on DIGITRACKER.</p>
          <p>Sign in and you'll find it in your sidebar as <strong>PROJECTS-${project}</strong>.</p>
          <p><a href="${projectUrl}" style="display:inline-block;background:#7c3aed;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;">Open project</a></p>
        </div>`,
    })

    await client.close()
    return { sent: true, error: null }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('sendProjectAddedEmail failed:', err)
    return { sent: false, error: message }
  }
}
