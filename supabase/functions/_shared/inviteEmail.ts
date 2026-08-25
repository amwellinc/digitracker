// Shared between provision-subscription and resend-invite: the branded
// email that doubles as a customer's order invoice and account-activation
// invite. Extracted here after a real incident — provision-subscription's
// own copy of this logic failed silently (both the primary SMTP send and
// the Supabase inviteUserByEmail fallback), and the fallback's error was
// being discarded with .catch(() => {}), so there was no way to even tell
// what had gone wrong, let alone recover the account it left stranded.
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'
import type { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const PRODUCT_WEBSITE = 'www.digitracker.co'

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

export interface InviteEmailInfo {
  companyName: string
  adminName: string
  adminEmail: string
  planName: string
  priceForEmail: string
  trialStartsAt: string | null
  trialEndsAt: string | null
  inviteLink: string | null
}

// Never throws. Returns whether the email actually sent, and the raw
// reason when it didn't, so a caller can log/notify/fall back deliberately
// instead of guessing.
export async function sendInviteAndInvoiceEmail(
  admin: ReturnType<typeof createClient>,
  info: InviteEmailInfo,
): Promise<{ sent: boolean; error: string | null }> {
  try {
    const { data: platform } = await admin
      .from('platform_settings')
      .select('smtp_host, smtp_port, smtp_secure, smtp_user, smtp_pass, from_email, from_name')
      .limit(1)
      .maybeSingle()

    if (!platform?.smtp_host || !platform.smtp_user || !platform.smtp_pass || !platform.from_email) {
      return { sent: false, error: 'SMTP is not configured in platform_settings.' }
    }

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

    await client.close()
    return { sent: true, error: null }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('sendInviteAndInvoiceEmail failed:', err)
    return { sent: false, error: message }
  }
}
