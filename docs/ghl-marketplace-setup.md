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
  │                                └─► Supabase Edge Function: ghl-oauth-callback
  │                                        │ stores tokens in ghl_installations
  │                                        └─► /#/ghl/connected (GHLConnectedPage)
  │
  └─ Webhooks ──────────────────► Supabase Edge Function: ghl-webhook
                                      │ handles: install, uninstall, contact events
                                      └─► ghl_contact_links table
```

## 1. Create GHL Marketplace App

1. Go to: https://marketplace.gohighlevel.com/developer
2. Create a new app:
   - **App Name**: DIGITRACKER by DIGI5Y
   - **Redirect URI**: `https://mllrjejqyddgaxxtjsqf.supabase.co/functions/v1/ghl-oauth-callback`
   - **Webhook URL**: `https://mllrjejqyddgaxxtjsqf.supabase.co/functions/v1/ghl-webhook`
   - **Scopes**: `contacts.readonly`, `contacts.write`, `locations.readonly`, `calendars.readonly`, `users.readonly`
   - **Install URL**: `https://digitracker.digi5y.co/#/install`
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

```bash
supabase functions deploy ghl-oauth-callback
supabase functions deploy ghl-webhook
```

## 4. Run Database Migration

```bash
supabase db push
# or apply migration 013_ghl_integration.sql manually via Supabase Dashboard SQL editor
```

## 5. Test the Flow

1. Navigate to `https://digitracker.digi5y.co/#/install` — see the install landing page
2. Sign in as an Admin user
3. Go to Settings → 🔗 GHL Integration
4. Click "Connect GoHighLevel"
5. Authorize in GHL
6. Verify redirect to `/#/ghl/connected?status=success`
7. Confirm Settings tab shows "Connected" state with location ID

## URL Reference

| Purpose | URL |
|---|---|
| Marketplace install | `https://digitracker.digi5y.co/#/install` |
| OAuth redirect URI | `https://mllrjejqyddgaxxtjsqf.supabase.co/functions/v1/ghl-oauth-callback` |
| Webhook endpoint | `https://mllrjejqyddgaxxtjsqf.supabase.co/functions/v1/ghl-webhook` |
| Post-OAuth success | `https://digitracker.digi5y.co/#/ghl/connected` |

## Database Tables Added

| Table | Purpose |
|---|---|
| `ghl_installations` | OAuth tokens per sub-account (service_role write only) |
| `ghl_contact_links` | GHL contacts synced via webhook |

## Webhook Events Handled

| GHL Event | Action |
|---|---|
| `LocationAppInstalled` | Logged (no action needed — user-initiated OAuth covers this) |
| `LocationAppUninstalled` | Removes tokens from `ghl_installations`, clears `sub_accounts.ghl_location_id` |
| `contact.created` | Upserts into `ghl_contact_links` |
| `contact.updated` | Updates name/email/phone in `ghl_contact_links` |
