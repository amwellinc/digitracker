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

export interface StaffInviteInfo {
  staffName: string
  staffEmail: string
  companyName: string
  inviteLink: string
}

// Re-invite for a staff member who already has a Supabase Auth user (from
// an earlier invite attempt) -- inviteUserByEmail fails on an existing
// user, so the caller gets a fresh action_link via generateLink({type:
// 'recovery'}) and hands it here to actually deliver. A staff member
// invited into an existing company account is not signing up for a plan of
// their own, so this is a plain "set your password" email with no plan/
// pricing content, same reasoning as sendAssociateInviteEmail.
export async function sendStaffInviteEmail(
  admin: ReturnType<typeof createClient>,
  info: StaffInviteInfo,
): Promise<{ sent: boolean; error: string | null }> {
  try {
    const { smtp, error } = await getPlatformSmtp(admin)
    if (!smtp) return { sent: false, error }
    const { client, from } = smtp

    await client.send({
      from,
      to: info.staffEmail,
      subject: `You now have access to ${info.companyName} on DIGITRACKER`,
      content: 'auto',
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
          <p>Hi ${info.staffName},</p>
          <p>You've been added to <strong>${info.companyName}</strong>'s DIGITRACKER workspace.</p>
          <p><a href="${info.inviteLink}" style="display:inline-block;background:#7c3aed;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;">Set your password &amp; sign in</a></p>
          <p>This link lets you set a password and sign in right away.</p>
        </div>`,
    })

    await client.close()
    return { sent: true, error: null }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('sendStaffInviteEmail failed:', err)
    return { sent: false, error: message }
  }
}

export interface AssociateInviteInfo {
  associateName: string
  associateEmail: string
  inviterName: string
  projectName: string
  inviteLink: string
}

// Re-invite for an associate who already has a Supabase Auth user (from an
// earlier invite) — generateLink/inviteUserByEmail can't be used again for
// them, so the caller gets a fresh action_link via generateLink({type:
// 'recovery'}) and hands it here to actually deliver. Associates are outside
// collaborators, not paying customers, so this is a plain "set your
// password" email with no plan/pricing content — see invite-associate's
// header comment for why that distinction matters.
export async function sendAssociateInviteEmail(
  admin: ReturnType<typeof createClient>,
  info: AssociateInviteInfo,
): Promise<{ sent: boolean; error: string | null }> {
  try {
    const { smtp, error } = await getPlatformSmtp(admin)
    if (!smtp) return { sent: false, error }
    const { client, from } = smtp

    await client.send({
      from,
      to: info.associateEmail,
      subject: `You've been added to "${info.projectName}" on DIGITRACKER`,
      content: 'auto',
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
          <p>Hi ${info.associateName},</p>
          <p>${info.inviterName} added you to the project <strong>${info.projectName}</strong> on DIGITRACKER.</p>
          <p><a href="${info.inviteLink}" style="display:inline-block;background:#7c3aed;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;">Set your password &amp; get started</a></p>
          <p>This link signs you in and lets you set a password — you'll only see this project, nothing else.</p>
        </div>`,
    })

    await client.close()
    return { sent: true, error: null }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('sendAssociateInviteEmail failed:', err)
    return { sent: false, error: message }
  }
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
