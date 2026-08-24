# GHL Marketplace App Setup Guide

DIGITRACKER is a GoHighLevel Marketplace App built by DIGI5Y.

## Architecture

```
GHL Marketplace
  │
  ├─ OAuth Install ──────────► /#/install   (GHLInstallPage)
  │                                │ user clicks "Sign In to Connect"
  │                                └─► /#/login (existing auth)
  │
  ├─ OAuth Authorization ───────► GHL chooselocation page
  │                                │ user grants access
  │                                └─► Supabase Edge Function: oauth-callback
  │                                        │ stores tokens in ghl_installations
  │                                        └─► /#/ghl/connected (GHLConnectedPage)
  │
  └─ Webhooks ──────────────────► Supabase Edge Function: crm-webhook
                                      │ handles: install, uninstall, contact events
                                      └─► ghl_contact_links table
```

> **Naming note:** the OAuth callback and webhook functions are deliberately
> *not* named `ghl-oauth-callback` / `ghl-webhook` — GHL's own validation
> rejects a registered redirect URI (and webhook URL) that contains "ghl"
> anywhere in the path. `ghl-refresh-token` and `ghl-disconnect` don't have
> this constraint since GHL never sees those URLs directly — they're called
> only from inside the app.

## 1. Create GHL Marketplace App

1. Go to: https://marketplace.gohighlevel.com/developer
2. Create a new app:
   - **App Name**: DIGITRACKER by DIGI5Y
   - **Redirect URI**: `https://mllrjejqyddgaxxtjsqf.supabase.co/functions/v1/oauth-callback`
   - **Webhook URL**: `https://mllrjejqyddgaxxtjsqf.supabase.co/functions/v1/crm-webhook`
   - **Scopes**: `contacts.readonly`, `contacts.write`, `locations.readonly`, `users.readonly`
   - **Install URL**: `https://digitracker-app.digi5y.co/#/install`
3. Note your **Client ID** and **Client Secret**

## 2. Configure Environment Variables

### Frontend (`.env`)
```
VITE_GHL_CLIENT_ID=your_client_id_here
```

### Supabase Edge Function Secrets (NEVER in .env)
```bash
supabase secrets set GHL_CLIENT_ID=your_client_id_here
supabase secrets set GHL_CLIENT_SECRET=your_client_secret_here
supabase secrets set GHL_WEBHOOK_SECRET=your_webhook_signing_key
```

## 3. Deploy Edge Functions

Deploys automatically via CI on push to `main` (`.github/workflows/deploy.yml`
loops over every `supabase/functions/*/` directory). To deploy manually:

```bash
supabase functions deploy oauth-callback --no-verify-jwt
supabase functions deploy crm-webhook --no-verify-jwt
supabase functions deploy ghl-refresh-token
supabase functions deploy ghl-disconnect
```

## 4. Run Database Migration

```bash
supabase db push
# or apply migrations 013_ghl_integration.sql and 054_ghl_oauth_consolidation.sql
# manually via Supabase Dashboard SQL editor
```

## 5. Test the Flow

1. Navigate to `https://digitracker-app.digi5y.co/#/install` — see the install landing page
2. Sign in as an Admin user
3. Go to Settings → GHL Integration
4. Click "Connect GoHighLevel"
5. Authorize in GHL
6. Verify redirect to `/#/ghl/connected?status=success`
7. Confirm Settings tab shows "Connected" state with location ID
8. Confirm "Refresh" and "Disconnect" both work

## URL Reference

| Purpose | URL |
|---|---|
| Marketplace install | `https://digitracker-app.digi5y.co/#/install` |
| OAuth redirect URI | `https://mllrjejqyddgaxxtjsqf.supabase.co/functions/v1/oauth-callback` |
| Webhook endpoint | `https://mllrjejqyddgaxxtjsqf.supabase.co/functions/v1/crm-webhook` |
| Post-OAuth success | `https://digitracker-app.digi5y.co/#/ghl/connected` |
| Privacy Policy | `https://digitracker-app.digi5y.co/#/privacy` |
| Terms of Service | `https://digitracker-app.digi5y.co/#/terms` |

## Database Tables Added

| Table | Purpose |
|---|---|
| `ghl_installations` | OAuth tokens per sub-account. `access_token`/`refresh_token` are readable only by service_role (edge functions) — `authenticated` is column-restricted to non-sensitive fields (migration 054). |
| `ghl_contact_links` | GHL contacts synced via webhook |

## Webhook Events Handled

| GHL Event | Action |
|---|---|
| `LocationAppInstalled` | Logged (no action needed — user-initiated OAuth covers this) |
| `LocationAppUninstalled` | Removes tokens from `ghl_installations`, clears `sub_accounts.ghl_location_id` |
| `contact.created` | Upserts into `ghl_contact_links` |
| `contact.updated` | Updates name/email/phone in `ghl_contact_links` |

## Token Refresh

GHL access tokens expire (~24h). `ghl-refresh-token` (Admin-only, called from
the "Refresh" button in Settings → GHL Integration) exchanges the stored
refresh_token for a new access token. There is no automatic/scheduled
refresh yet — nothing in this codebase currently makes outbound authenticated
calls to the GHL API using the stored token, so add a proactive refresh
(e.g. a cron-triggered edge function) once that exists.
