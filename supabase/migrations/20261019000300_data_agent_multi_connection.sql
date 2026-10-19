-- Migration 20261019000300: Data Agent — support multiple named GHL
-- connections per sub-account.
--
-- data_agent_connections previously had `sub_account` as its PRIMARY KEY,
-- meaning exactly one GHL connection could ever exist per DigiTracker
-- sub-account — there was no way to add a second one, and nothing
-- distinguished "which real GHL account" a saved connection pointed at
-- (no name/label, just a bare location id buried in a form). This
-- reshapes the table to (id primary key, many rows per sub_account, each
-- with a required label) and threads a connection_id through migrations
-- and the schema cache, since two connections for the same sub_account
-- point at two different real GHL accounts with different custom-field
-- schemas — sharing one schema-cache row keyed only by sub_account would
-- silently mix them up.

-- ── data_agent_connections: id becomes the primary key ─────────────────────
alter table public.data_agent_connections add column id uuid default gen_random_uuid();
alter table public.data_agent_connections add column label text;
update public.data_agent_connections set label = 'Default Connection' where label is null;
alter table public.data_agent_connections alter column id set not null;
alter table public.data_agent_connections alter column label set not null;
alter table public.data_agent_connections add constraint data_agent_connections_label_check check (length(trim(label)) > 0);

alter table public.data_agent_connections drop constraint data_agent_connections_pkey;
alter table public.data_agent_connections add primary key (id);
-- sub_account's own FK to sub_accounts(code) was created inline on the old
-- primary-key column declaration — that FK constraint is separate from the
-- primary key constraint just dropped above and survives untouched.
alter table public.data_agent_connections add constraint data_agent_connections_sub_account_location_key
  unique (sub_account, ghl_location_id);

-- ── data_agent_migrations: record which connection was used ─────────────────
alter table public.data_agent_migrations add column connection_id uuid references public.data_agent_connections(id) on delete set null;
update public.data_agent_migrations m set connection_id = (
  select c.id from public.data_agent_connections c where c.sub_account = m.sub_account limit 1
) where connection_id is null;

-- ── data_agent_ghl_schema_cache: key by connection, not sub_account ─────────
alter table public.data_agent_ghl_schema_cache add column connection_id uuid references public.data_agent_connections(id) on delete cascade;
update public.data_agent_ghl_schema_cache t set connection_id = (
  select c.id from public.data_agent_connections c where c.sub_account = t.sub_account limit 1
) where connection_id is null;
alter table public.data_agent_ghl_schema_cache drop constraint if exists data_agent_ghl_schema_cache_sub_account_object_type_key;
alter table public.data_agent_ghl_schema_cache add constraint data_agent_ghl_schema_cache_connection_object_type_key
  unique (connection_id, object_type);

-- ── Connection write paths ───────────────────────────────────────────────────
-- save_data_agent_connection assumed exactly one connection per
-- sub_account (upserting on that single row) — replaced with explicit
-- add/update-token/delete operations over named, individually-addressed
-- connections.
drop function if exists public.save_data_agent_connection(text, text, text);

create or replace function public.add_data_agent_connection(p_sub_account text, p_label text, p_ghl_location_id text, p_pit text)
  returns uuid
  language plpgsql security definer
  set search_path = public
as $$
declare
  v_id uuid := gen_random_uuid();
  v_secret_name text := 'data_agent_pit_' || v_id;
begin
  if not coalesce(
    public.auth_user_role() = 'Super-Admin'
    or (public.auth_user_role() = 'Admin' and public.auth_user_sub_account() = p_sub_account),
    false
  ) then
    raise exception 'Not authorized to connect this sub-account';
  end if;
  if not exists (select 1 from public.data_agent_entitlements where sub_account = p_sub_account and enabled) then
    raise exception 'Data Agent is not enabled for this sub-account';
  end if;
  if length(trim(coalesce(p_label, ''))) = 0 then
    raise exception 'A connection name is required';
  end if;
  if length(trim(coalesce(p_ghl_location_id, ''))) = 0 then
    raise exception 'A GHL location id is required';
  end if;
  if length(trim(coalesce(p_pit, ''))) = 0 then
    raise exception 'A Private Integration Token is required';
  end if;

  perform vault.create_secret(p_pit, v_secret_name, 'Data Agent GHL PIT for ' || p_sub_account || ' (' || trim(p_label) || ')');

  insert into public.data_agent_connections (id, sub_account, label, ghl_location_id, secret_name, connected_by, connected_at)
  values (v_id, p_sub_account, trim(p_label), trim(p_ghl_location_id), v_secret_name, public.auth_user_app_id(), now());

  return v_id;
end;
$$;
revoke execute on function public.add_data_agent_connection(text, text, text, text) from public, anon;
grant execute on function public.add_data_agent_connection(text, text, text, text) to authenticated;

create or replace function public.update_data_agent_connection_token(p_connection_id uuid, p_pit text)
  returns void
  language plpgsql security definer
  set search_path = public
as $$
declare
  v_sub_account text;
  v_secret_name text;
begin
  select sub_account, secret_name into v_sub_account, v_secret_name
    from public.data_agent_connections where id = p_connection_id;
  if v_sub_account is null then raise exception 'Connection not found'; end if;
  if not coalesce(
    public.auth_user_role() = 'Super-Admin'
    or (public.auth_user_role() = 'Admin' and public.auth_user_sub_account() = v_sub_account),
    false
  ) then
    raise exception 'Not authorized to update this connection';
  end if;
  if length(trim(coalesce(p_pit, ''))) = 0 then raise exception 'A Private Integration Token is required'; end if;

  perform vault.update_secret((select id from vault.secrets where name = v_secret_name), p_pit);
end;
$$;
revoke execute on function public.update_data_agent_connection_token(uuid, text) from public, anon;
grant execute on function public.update_data_agent_connection_token(uuid, text) to authenticated;

create or replace function public.delete_data_agent_connection(p_connection_id uuid)
  returns void
  language plpgsql security definer
  set search_path = public
as $$
declare
  v_sub_account text;
  v_secret_name text;
begin
  select sub_account, secret_name into v_sub_account, v_secret_name
    from public.data_agent_connections where id = p_connection_id;
  if v_sub_account is null then raise exception 'Connection not found'; end if;
  if not coalesce(
    public.auth_user_role() = 'Super-Admin'
    or (public.auth_user_role() = 'Admin' and public.auth_user_sub_account() = v_sub_account),
    false
  ) then
    raise exception 'Not authorized to remove this connection';
  end if;
  if exists (select 1 from public.data_agent_migrations where connection_id = p_connection_id) then
    raise exception 'This connection has migration history and cannot be removed — rotate its token instead, or leave it in place';
  end if;

  delete from vault.secrets where name = v_secret_name;
  delete from public.data_agent_connections where id = p_connection_id;
end;
$$;
revoke execute on function public.delete_data_agent_connection(uuid) from public, anon;
grant execute on function public.delete_data_agent_connection(uuid) to authenticated;

-- get_data_agent_pit: sub_account is no longer a unique key for "the"
-- connection now that several can exist per sub_account — switched to the
-- unambiguous connection_id.
drop function if exists public.get_data_agent_pit(text);

create or replace function public.get_data_agent_pit(p_connection_id uuid)
  returns text
  language plpgsql security definer
  set search_path = public
as $$
declare
  v_secret_name text;
  v_pit text;
begin
  select secret_name into v_secret_name from public.data_agent_connections where id = p_connection_id;
  if v_secret_name is null then return null; end if;
  select decrypted_secret into v_pit from vault.decrypted_secrets where name = v_secret_name;
  return v_pit;
end;
$$;
revoke execute on function public.get_data_agent_pit(uuid) from public, anon, authenticated;
grant execute on function public.get_data_agent_pit(uuid) to service_role;
