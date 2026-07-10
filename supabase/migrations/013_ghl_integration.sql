-- ============================================================
-- 013_ghl_integration.sql
-- GoHighLevel Marketplace App integration
-- ============================================================

-- Add GHL fields to sub_accounts
alter table public.sub_accounts
  add column if not exists ghl_location_id   text,
  add column if not exists ghl_connected_at  timestamptz;

-- ── ghl_installations ────────────────────────────────────────────────────────
-- Stores one OAuth token set per sub-account. Managed exclusively by the
-- ghl-oauth-callback edge function (service role). Users can read status
-- fields but never the raw tokens.

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

-- Users in the sub-account can read non-sensitive installation metadata.
-- access_token / refresh_token are only accessible via service_role (edge functions).
create policy "ghl_installations_select_own"
  on public.ghl_installations for select
  using (sub_account = public.auth_user_sub_account());

-- Only edge functions (service_role) can write installation records.
-- No user-facing insert/update/delete policies intentionally.

-- ── ghl_contact_links ────────────────────────────────────────────────────────
-- Maps GHL contact IDs to DIGITRACKER users (populated by webhook handler).

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

create policy "ghl_contact_links_select_own"
  on public.ghl_contact_links for select
  using (sub_account = public.auth_user_sub_account());

create policy "ghl_contact_links_write_admin"
  on public.ghl_contact_links for all
  using (
    sub_account = public.auth_user_sub_account()
    and public.auth_user_role() in ('Admin', 'Super-Admin', 'Super-admin')
  );

-- Enable realtime so the settings tab refreshes automatically
alter publication supabase_realtime add table public.ghl_installations;
