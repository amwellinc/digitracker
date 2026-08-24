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
--    columns. Fixed at the grant level, not just by convention: revoke
--    authenticated's blanket SELECT on the base table and expose only a
--    safe view of non-sensitive columns instead.
--
-- 2. Two competing OAuth implementations existed side by side: an n8n-based
--    exchange (GHLConnectedPage.tsx posting to an external webhook, tokens
--    never touching Supabase, connection state kept only in localStorage)
--    was the one actually reachable from GHL's redirect, while this
--    project's own ghl-oauth-callback edge function + ghl_installations
--    table (this migration's parent, 013) sat unreachable — nothing
--    redirected to it. Consolidating onto the Supabase-native path per
--    explicit instruction; the n8n exchange is being retired.

-- ── Close the column-exposure gap ───────────────────────────────────────────
-- Column-level GRANTs, not a view: a view owned by the migration role would
-- either need security_invoker (which requires the caller to hold the same
-- base-table grant we're trying to remove) or risk running with the owner's
-- privileges and silently bypassing RLS entirely — the wrong direction for
-- a table already scoped by sub_account. Restricting which columns
-- `authenticated` can select directly on the base table keeps RLS exactly
-- as before (still enforced per-caller) while making access_token /
-- refresh_token genuinely unreadable by that role — service_role
-- (edge functions) is untouched by this and keeps full access.

drop policy if exists "ghl_installations_select_own" on public.ghl_installations;
create policy "ghl_installations_select_own" on public.ghl_installations
  for select using (sub_account = public.auth_user_sub_account());

revoke select on public.ghl_installations from authenticated;
grant select (id, sub_account, ghl_location_id, ghl_company_id, ghl_user_id, scope, expires_at, installed_at, updated_at)
  on public.ghl_installations to authenticated;

notify pgrst, 'reload schema';
