import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const body = await req.text()

  // Verify GHL webhook signature when secret is configured
  const webhookSecret = Deno.env.get('GHL_WEBHOOK_SECRET')
  const signature     = req.headers.get('x-ghl-signature') ?? req.headers.get('x-hub-signature-256') ?? ''

  if (webhookSecret && signature) {
    const expected = await hmacSha256Hex(webhookSecret, body)
    // GHL may prefix with 'sha256='
    const bare = signature.startsWith('sha256=') ? signature.slice(7) : signature
    if (!timingSafeEqual(expected, bare)) {
      console.warn('Invalid GHL webhook signature')
      return new Response('Invalid signature', { status: 401 })
    }
  }

  let event: Record<string, unknown>
  try {
    event = JSON.parse(body)
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const eventType = (event.type ?? event.event ?? '') as string
  const locationId = (event.locationId ?? event.location_id ?? '') as string

  console.log('GHL webhook:', eventType, locationId)

  try {
    await handleEvent(supabase, eventType, locationId, event)
  } catch (err) {
    console.error('Webhook handler error:', err)
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' },
  })
})

type SupabaseClient = ReturnType<typeof createClient>

async function handleEvent(
  supabase: SupabaseClient,
  eventType: string,
  locationId: string,
  event: Record<string, unknown>,
) {
  switch (eventType) {
    case 'LocationAppInstalled':
    case 'AppInstalled':
    case 'INSTALL': {
      console.log('App installed at location:', locationId)
      break
    }

    case 'LocationAppUninstalled':
    case 'AppUninstalled':
    case 'UNINSTALL': {
      if (locationId) {
        await supabase
          .from('ghl_installations')
          .delete()
          .eq('ghl_location_id', locationId)
        await supabase
          .from('sub_accounts')
          .update({ ghl_location_id: null, ghl_connected_at: null })
          .eq('ghl_location_id', locationId)
        console.log('App uninstalled, tokens removed for location:', locationId)
      }
      break
    }

    case 'contact.created':
    case 'ContactCreated': {
      const contact = (event.contact ?? event) as Record<string, string>
      if (!locationId || !contact.id) break
      const subAccount = await subAccountForLocation(supabase, locationId)
      if (!subAccount) break
      await supabase.from('ghl_contact_links').upsert(
        {
          sub_account:    subAccount,
          ghl_contact_id: contact.id,
          ghl_email:      contact.email ?? null,
          ghl_name:       `${contact.firstName ?? ''} ${contact.lastName ?? ''}`.trim() || null,
          ghl_phone:      contact.phone ?? null,
          synced_at:      new Date().toISOString(),
        },
        { onConflict: 'sub_account,ghl_contact_id' },
      )
      break
    }

    case 'contact.updated':
    case 'ContactUpdated': {
      const contact = (event.contact ?? event) as Record<string, string>
      if (!locationId || !contact.id) break
      const subAccount = await subAccountForLocation(supabase, locationId)
      if (!subAccount) break
      await supabase
        .from('ghl_contact_links')
        .update({
          ghl_email: contact.email ?? null,
          ghl_name:  `${contact.firstName ?? ''} ${contact.lastName ?? ''}`.trim() || null,
          ghl_phone: contact.phone ?? null,
          synced_at: new Date().toISOString(),
        })
        .match({ sub_account: subAccount, ghl_contact_id: contact.id })
      break
    }

    default:
      console.log('Unhandled GHL event type:', eventType)
  }
}

async function subAccountForLocation(supabase: SupabaseClient, locationId: string): Promise<string | null> {
  const { data } = await supabase
    .from('ghl_installations')
    .select('sub_account')
    .eq('ghl_location_id', locationId)
    .maybeSingle()
  return data?.sub_account ?? null
}

async function hmacSha256Hex(secret: string, data: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data))
  return Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}
