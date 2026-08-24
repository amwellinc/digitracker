-- Migration 054: Consolidate the GHL Marketplace OAuth flow onto the
-- Supabase-native path and close a token-exposure gap found while
-- reviewing it for Marketplace readiness.
--
-- Two prior versions of this migration both failed to deploy with no
-- accessible error detail (GitHub's API doesn't expose raw job logs here).
-- Both referenced public.ghl_installations and nothing else in common —
-- the first used column-level GRANT/REVOKE (untested anywhere else in this
-- schema), the second a plain SECURITY DEFINER function (a pattern used
-- successfully dozens of times elsewhere). That two otherwise-unrelated
-- approaches both failed points at the one thing they shared rather than
-- either one's syntax: ghl_installations itself may never have actually
-- existed live. Migration 013 created it, but nothing exercised that table
-- until now — no working code ever queried it (the OAuth flow that should
-- have populated it was unreachable; see GHLIntegrationTab.tsx's history).
-- A migration can fail to apply just as silently as an RLS policy can, and
-- there'd have been no symptom until something finally tried to use it.
--
-- Same fix as the payroll RLS incident (migration 048): rather than keep
-- guessing from file history, force-reassert the whole of 013 idempotently
-- — a safe no-op if it was already there, a real fix if it wasn't.

create table if not exists public.ghl_installations (
  id              uuid        primary key default gen_random_uuid(),
  sub_account     text        not null unique references public.sub_accounts(code) on delete cascade,
  ghl_location_id text        not null,
  ghl_company_id  text,
  ghl_user_id     text,
  access_token    text        not null,
  refresh_token   text        not null,
  expires_at      timestamptz not null,
  scope           text,
  installed_at    timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.ghl_installations enable row level security;

drop policy if exists "ghl_installations_select_own" on public.ghl_installations;
create policy "ghl_installations_select_own" on public.ghl_installations
  for select using (sub_account = public.auth_user_sub_account());

create table if not exists public.ghl_contact_links (
  id             uuid        primary key default gen_random_uuid(),
  sub_account    text        not null references public.sub_accounts(code) on delete cascade,
  ghl_contact_id text        not null,
  user_id        uuid        references public.users(id) on delete set null,
  ghl_email      text,
  ghl_name       text,
  ghl_phone      text,
  synced_at      timestamptz not null default now(),
  unique (sub_account, ghl_contact_id)
);

alter table public.ghl_contact_links enable row level security;

drop policy if exists "ghl_contact_links_select_own" on public.ghl_contact_links;
create policy "ghl_contact_links_select_own" on public.ghl_contact_links
  for select using (sub_account = public.auth_user_sub_account());

drop policy if exists "ghl_contact_links_write_admin" on public.ghl_contact_links;
create policy "ghl_contact_links_write_admin" on public.ghl_contact_links
  for all using (
    sub_account = public.auth_user_sub_account()
    and public.auth_user_role() in ('Admin', 'Super-Admin')
  );

alter table public.sub_accounts
  add column if not exists ghl_location_id  text,
  add column if not exists ghl_connected_at timestamptz;

DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.ghl_installations; EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- ── Close the token-exposure gap ────────────────────────────────────────────
-- ghl_installations_select_own has no column restriction — any authenticated
-- member of the sub-account could read raw OAuth tokens via select('*').
-- Nothing queries the base table directly (this function replaces the one
-- place that would have); SECURITY DEFINER + an explicit column list means
-- access_token/refresh_token can never leak through it regardless of what
-- the caller asks for.

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
