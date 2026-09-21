// Shared SMTP client setup, sourced from platform_settings. Extracted out of
// inviteEmail.ts once a second caller (accountEmails.ts) needed the exact
// same connection logic — a single call site didn't justify the indirection,
// two did.
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'
import type { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

export interface PlatformSmtp {
  client: SMTPClient
  from: string
}

// Returns null (with a reason) when SMTP isn't configured, so callers can
// decide how to handle a missing config without throwing.
export async function getPlatformSmtp(
  admin: ReturnType<typeof createClient>,
): Promise<{ smtp: PlatformSmtp | null; error: string | null }> {
  const { data: platform } = await admin
    .from('platform_settings')
    .select('smtp_host, smtp_port, smtp_secure, smtp_user, smtp_pass, from_email, from_name')
    .limit(1)
    .maybeSingle()

  if (!platform?.smtp_host || !platform.smtp_user || !platform.smtp_pass || !platform.from_email) {
    return { smtp: null, error: 'SMTP is not configured in platform_settings.' }
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
  return { smtp: { client, from }, error: null }
}
