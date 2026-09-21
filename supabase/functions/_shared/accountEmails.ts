// Security notice sent to a user's OLD email address when an Admin changes
// their account email. Separate from the sign-in invite (sent to the NEW
// address via the ordinary Supabase magic-link flow) because Supabase has no
// built-in template for "your email was changed by an admin" — that has to
// be a custom send through the platform's own SMTP config.
import type { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getPlatformSmtp } from './smtp.ts'

export interface EmailChangedNoticeInfo {
  userName: string
  oldEmail: string
  newEmail: string
}

// Never throws — a failed notice should never block the email change itself,
// which has already happened by the time this is called.
export async function sendEmailChangedNotice(
  admin: ReturnType<typeof createClient>,
  info: EmailChangedNoticeInfo,
): Promise<{ sent: boolean; error: string | null }> {
  try {
    const { smtp, error } = await getPlatformSmtp(admin)
    if (!smtp) return { sent: false, error }
    const { client, from } = smtp

    await client.send({
      from,
      to: info.oldEmail,
      subject: 'Your DIGITRACKER sign-in email was changed',
      content: 'auto',
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
          <p>Hi ${info.userName},</p>
          <p>Your DIGITRACKER sign-in email was just changed from
          <strong>${info.oldEmail}</strong> to <strong>${info.newEmail}</strong>
          by an administrator on your account.</p>
          <p>A new sign-in link has been sent to the new address. If you did not
          expect this change, contact your administrator immediately.</p>
        </div>`,
    })

    await client.close()
    return { sent: true, error: null }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('sendEmailChangedNotice failed:', err)
    return { sent: false, error: message }
  }
}
