import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const GHL_TOKEN_URL = 'https://services.leadconnectorhq.com/oauth/token'
const FRONTEND_URL  = 'https://digitracker.digi5y.co'

Deno.serve(async (req) => {
  const url = new URL(req.url)
  const code  = url.searchParams.get('code')
  const state = url.searchParams.get('state')   // sub_account code
  const error = url.searchParams.get('error')

  const redirect = (status: string, extra = '') =>
    Response.redirect(`${FRONTEND_URL}/#/ghl/connected?status=${status}${extra}`)

  if (error) return redirect('error', `&reason=${encodeURIComponent(error)}`)
  if (!code || !state) return redirect('error', '&reason=missing_params')

  const clientId     = Deno.env.get('GHL_CLIENT_ID')
  const clientSecret = Deno.env.get('GHL_CLIENT_SECRET')
  const supabaseUrl  = Deno.env.get('SUPABASE_URL')!
  const serviceKey   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  if (!clientId || !clientSecret) {
    console.error('GHL_CLIENT_ID or GHL_CLIENT_SECRET not configured')
    return redirect('error', '&reason=not_configured')
  }

  const redirectUri = `${supabaseUrl}/functions/v1/ghl-oauth-callback`

  // Exchange authorization code for tokens
  let tokenData: {
    access_token: string
    refresh_token: string
    expires_in: number
    locationId: string
    companyId?: string
    userId?: string
    scope?: string
  }

  try {
    const tokenRes = await fetch(GHL_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     clientId,
        client_secret: clientSecret,
        grant_type:    'authorization_code',
        code,
        redirect_uri:  redirectUri,
        user_type:     'Location',
      }),
    })

    if (!tokenRes.ok) {
      const txt = await tokenRes.text()
      console.error('GHL token exchange failed:', tokenRes.status, txt)
      return redirect('error', '&reason=token_exchange_failed')
    }

    tokenData = await tokenRes.json()
  } catch (err) {
    console.error('Token exchange fetch error:', err)
    return redirect('error', '&reason=network_error')
  }

  const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
  const now       = new Date().toISOString()

  const supabase = createClient(supabaseUrl, serviceKey)

  // Upsert installation record
  const { error: dbErr } = await supabase
    .from('ghl_installations')
    .upsert(
      {
        sub_account:     state,
        ghl_location_id: tokenData.locationId,
        ghl_company_id:  tokenData.companyId  ?? null,
        ghl_user_id:     tokenData.userId      ?? null,
        access_token:    tokenData.access_token,
        refresh_token:   tokenData.refresh_token,
        expires_at:      expiresAt,
        scope:           tokenData.scope ?? null,
        updated_at:      now,
      },
      { onConflict: 'sub_account' },
    )

  if (dbErr) {
    console.error('DB upsert error:', dbErr)
    return redirect('error', '&reason=db_error')
  }

  // Record GHL location on the sub_account row
  await supabase
    .from('sub_accounts')
    .update({ ghl_location_id: tokenData.locationId, ghl_connected_at: now })
    .eq('code', state)

  return redirect('success', `&location_id=${encodeURIComponent(tokenData.locationId)}`)
})
