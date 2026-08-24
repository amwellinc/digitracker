-- Migration 054: Consolidate the GHL Marketplace OAuth flow onto the
-- Supabase-native path and close a token-exposure gap found while
-- reviewing it for Marketplace readiness.
--
-- 1. Token exposure: ghl_installations_select_own's comment claims
--    "access_token / refresh_token are only accessible via service_role",
--    but the policy itself has no column restriction — RLS governs ROWS,
--    not columns, so any authenticated member of the sub-account could
--    read the raw OAuth tokens via a plain select('*'). Nothing in the
--    app queries this table directly today (confirmed by search), so this
--    was never actually exploited, but it's exactly the kind of gap that
--    turns into a real leak the moment someone builds the natural next
--    feature (a connection-status query) without knowing to hand-pick
--    columns.
--
--    Fixed via a SECURITY DEFINER function returning only non-sensitive
--    columns, the same pattern already used throughout this schema (e.g.
--    get_trial_days, check_account_status) — not column-level GRANT/REVOKE,
--    which this schema has never used anywhere and which broke this
--    migration's first version (deploy failure with no accessible error
--    detail; column-privilege revocation apparently isn't available to
--    the role `supabase db push` runs migrations as on this project).
--    The existing row-level policy on the base table is untouched.
--
-- 2. Two competing OAuth implementations existed side by side: an n8n-based
--    exchange (GHLConnectedPage.tsx posting to an external webhook, tokens
--    never touching Supabase, connection state kept only in localStorage)
--    was the one actually reachable from GHL's redirect, while this
--    project's own oauth-callback edge function + ghl_installations
--    table (this migration's parent, 013) sat unreachable — nothing
--    redirected to it. Consolidating onto the Supabase-native path per
--    explicit instruction; the n8n exchange is being retired.

create or replace function public.get_ghl_installation()
  returns table (
    id uuid,
    sub_account text,
    ghl_location_id text,
    ghl_company_id text,
    ghl_user_id text,
    scope text,
    expires_at timestamptz,
    installed_at timestamptz,
    updated_at timestamptz
  )
  language sql security definer stable
as $$
  select i.id, i.sub_account, i.ghl_location_id, i.ghl_company_id, i.ghl_user_id,
         i.scope, i.expires_at, i.installed_at, i.updated_at
  from public.ghl_installations i
  where i.sub_account = public.auth_user_sub_account()
$$;

grant execute on function public.get_ghl_installation() to authenticated;

notify pgrst, 'reload schema';
