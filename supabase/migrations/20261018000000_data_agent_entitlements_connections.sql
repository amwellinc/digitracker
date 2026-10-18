-- Migration 20261018000000: Data Agent — entitlements, membership, GHL
-- connection, and schema cache (spec 2026-10-18-data-agent-design.md §2-3).
--
-- Any table created after 20261006000100_associates_lock.sql must add its
-- own "<table>_deny_associates" policy (enforced by the generic test in
-- src/__tests__/associateLock.test.ts) — Data Agent is not part of the
-- Associate's allowed scope.

create table public.data_agent_entitlements (
  sub_account text primary key references public.sub_accounts(code) on delete cascade,
  enabled     boolean not null default true,
  enabled_by  uuid references public.users(id) on delete set null,
  enabled_at  timestamptz not null default now()
);

create table public.data_agent_members (
  sub_account text not null references public.sub_accounts(code) on delete cascade,
  user_id     uuid not null references public.users(id) on delete cascade,
  added_by    uuid references public.users(id) on delete set null,
  added_at    timestamptz not null default now(),
  primary key (sub_account, user_id)
);

create table public.data_agent_connections (
  sub_account       text primary key references public.sub_accounts(code) on delete cascade,
  ghl_location_id   text not null check (length(trim(ghl_location_id)) > 0),
  secret_name       text not null,
  connected_by      uuid references public.users(id) on delete set null,
  connected_at      timestamptz not null default now(),
  last_verified_at  timestamptz
);

create table public.data_agent_ghl_schema_cache (
  id          uuid primary key default gen_random_uuid(),
  sub_account text not null references public.sub_accounts(code) on delete cascade,
  object_type text not null,
  fields      jsonb not null default '[]'::jsonb,
  fetched_at  timestamptz not null default now(),
  unique (sub_account, object_type)
);

-- ── Access gate ─────────────────────────────────────────────────────────────
-- Mirrors is_project_member(): one helper, every policy in this feature
-- uses it. Entitled AND (Super-Admin OR that sub-account's Admin OR a
-- data_agent_members row for that sub-account).
create or replace function public.is_data_agent_member(p_sub_account text)
  returns boolean
  language sql security definer stable
  set search_path = public
as $$
  select
    exists (select 1 from public.data_agent_entitlements e where e.sub_account = p_sub_account and e.enabled)
    and (
      public.auth_user_role() = 'Super-Admin'
      or (
        public.auth_user_sub_account() = p_sub_account
        and (
          public.auth_user_role() = 'Admin'
          or exists (select 1 from public.data_agent_members m where m.sub_account = p_sub_account and m.user_id = public.auth_user_app_id())
        )
      )
    )
$$;
revoke execute on function public.is_data_agent_member(text) from public, anon;
grant execute on function public.is_data_agent_member(text) to authenticated;

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.data_agent_entitlements enable row level security;
alter table public.data_agent_members enable row level security;
alter table public.data_agent_connections enable row level security;
alter table public.data_agent_ghl_schema_cache enable row level security;

create policy data_agent_entitlements_select on public.data_agent_entitlements
  for select using (public.is_data_agent_member(sub_account));
create policy data_agent_entitlements_write on public.data_agent_entitlements
  for all using (public.auth_user_role() = 'Super-Admin')
  with check (public.auth_user_role() = 'Super-Admin');

create policy data_agent_members_select on public.data_agent_members
  for select using (public.is_data_agent_member(sub_account));
create policy data_agent_members_write on public.data_agent_members
  for all using (
    public.auth_user_role() = 'Super-Admin'
    or (public.auth_user_role() = 'Admin' and public.auth_user_sub_account() = sub_account)
  )
  with check (
    public.auth_user_role() = 'Super-Admin'
    or (public.auth_user_role() = 'Admin' and public.auth_user_sub_account() = sub_account)
  );

-- Connections: readable by members; no insert/update/delete policy at all
-- (default-deny) — the only write path is save_data_agent_connection()
-- below (SECURITY DEFINER) or the service role, so the PIT never has a
-- client-reachable write route into this table.
create policy data_agent_connections_select on public.data_agent_connections
  for select using (public.is_data_agent_member(sub_account));

create policy data_agent_ghl_schema_cache_select on public.data_agent_ghl_schema_cache
  for select using (public.is_data_agent_member(sub_account));

-- ── Associate lock ───────────────────────────────────────────────────────────
create policy data_agent_entitlements_deny_associates on public.data_agent_entitlements
  as restrictive for all to authenticated
  using (not (select public.is_associate())) with check (not (select public.is_associate()));
create policy data_agent_members_deny_associates on public.data_agent_members
  as restrictive for all to authenticated
  using (not (select public.is_associate())) with check (not (select public.is_associate()));
create policy data_agent_connections_deny_associates on public.data_agent_connections
  as restrictive for all to authenticated
  using (not (select public.is_associate())) with check (not (select public.is_associate()));
create policy data_agent_ghl_schema_cache_deny_associates on public.data_agent_ghl_schema_cache
  as restrictive for all to authenticated
  using (not (select public.is_associate())) with check (not (select public.is_associate()));

-- ── Connection write path ────────────────────────────────────────────────────
-- The PIT is passed in once, from an authenticated Admin/Super-Admin
-- session, straight into Vault — it is never stored in a plain column and
-- never read back by this function. "Test Connection" (Task 5) reads it
-- back later, server-side only, via vault.decrypted_secrets.
create or replace function public.save_data_agent_connection(p_sub_account text, p_ghl_location_id text, p_pit text)
  returns void
  language plpgsql security definer
  set search_path = public
as $$
declare
  v_secret_name text := 'data_agent_pit_' || p_sub_account;
  v_existing_id uuid;
begin
  if public.auth_user_role() is distinct from 'Super-Admin'
     and not (public.auth_user_role() = 'Admin' and public.auth_user_sub_account() = p_sub_account) then
    raise exception 'Not authorized to connect this sub-account';
  end if;
  if not exists (select 1 from public.data_agent_entitlements where sub_account = p_sub_account and enabled) then
    raise exception 'Data Agent is not enabled for this sub-account';
  end if;
  if length(trim(coalesce(p_ghl_location_id, ''))) = 0 then
    raise exception 'A GHL location id is required';
  end if;
  if length(trim(coalesce(p_pit, ''))) = 0 then
    raise exception 'A Private Integration Token is required';
  end if;

  select id into v_existing_id from vault.secrets where name = v_secret_name;
  if v_existing_id is null then
    perform vault.create_secret(p_pit, v_secret_name, 'Data Agent GHL PIT for ' || p_sub_account);
  else
    perform vault.update_secret(v_existing_id, p_pit);
  end if;

  insert into public.data_agent_connections (sub_account, ghl_location_id, secret_name, connected_by, connected_at)
  values (p_sub_account, trim(p_ghl_location_id), v_secret_name, public.auth_user_app_id(), now())
  on conflict (sub_account) do update set
    ghl_location_id = excluded.ghl_location_id,
    secret_name     = excluded.secret_name,
    connected_by    = excluded.connected_by,
    connected_at    = excluded.connected_at;
end;
$$;
revoke execute on function public.save_data_agent_connection(text, text, text) from public, anon;
grant execute on function public.save_data_agent_connection(text, text, text) to authenticated;
