-- Migration 20261018000100: Data Agent — migration pipeline tables, CSV
-- storage bucket, and curated source-system profiles (spec §4-6, §9, §11).

create table public.data_agent_migrations (
  id                  uuid primary key default gen_random_uuid(),
  sub_account         text not null references public.sub_accounts(code) on delete cascade,
  created_by          uuid references public.users(id) on delete set null,
  target_object_type  text not null,
  source_system       text check (source_system in ('salesforce', 'hubspot')),
  original_filename   text not null,
  storage_path        text not null,
  row_count           integer not null default 0,
  match_key_column    text,
  default_country_code text, -- e.g. '+65'; required by the gate below whenever a mapped phone column's sample values are absent/mixed on country code (spec §6.1 step 3, §7 step 2)
  status              text not null default 'uploaded' check (status in (
                        'uploaded', 'mapping', 'awaiting_confirmation', 'migrating',
                        'verifying', 'completed', 'failed', 'cancelled', 'undoing', 'undone')),
  accuracy_rating     numeric,
  started_at          timestamptz,
  completed_at        timestamptz,
  error_message       text,
  created_at          timestamptz not null default now()
);
create index data_agent_migrations_sub_account_idx on public.data_agent_migrations (sub_account, created_at desc);

create table public.data_agent_column_mappings (
  id                  uuid primary key default gen_random_uuid(),
  migration_id        uuid not null references public.data_agent_migrations(id) on delete cascade,
  source_column_name  text not null,
  sample_values       jsonb not null default '[]'::jsonb,
  target_type         text not null default 'ignored' check (target_type in ('standard_field', 'custom_field', 'tag', 'ignored')),
  target_field_key    text,
  status              text not null default 'unmapped' check (status in ('mapped', 'uncertain', 'unmapped')),
  confidence           numeric,
  reasoning            text,
  mapped_by            text check (mapped_by in ('rule', 'source_profile', 'claude', 'user')),
  confirmed_by_user    boolean not null default false,
  metadata             jsonb not null default '{}'::jsonb
);
create index data_agent_column_mappings_migration_idx on public.data_agent_column_mappings (migration_id);

create table public.data_agent_migration_records (
  id                     uuid primary key default gen_random_uuid(),
  migration_id           uuid not null references public.data_agent_migrations(id) on delete cascade,
  row_number             integer not null,
  source_row_data        jsonb not null,
  ghl_record_id          text,
  pre_replace_snapshot   jsonb,
  write_status           text not null default 'pending' check (write_status in ('pending', 'created', 'replaced', 'failed', 'skipped')),
  error_message          text,
  written_at             timestamptz
);
create index data_agent_migration_records_migration_idx on public.data_agent_migration_records (migration_id, row_number);
create index data_agent_migration_records_status_idx on public.data_agent_migration_records (migration_id, write_status);

create table public.data_agent_qa_samples (
  id                   uuid primary key default gen_random_uuid(),
  migration_record_id uuid not null references public.data_agent_migration_records(id) on delete cascade,
  fetched_ghl_data     jsonb not null,
  field_comparisons    jsonb not null default '[]'::jsonb,
  match_pct            numeric not null,
  created_at           timestamptz not null default now()
);

create table public.data_agent_source_profiles (
  id                 uuid primary key default gen_random_uuid(),
  source_system      text not null check (source_system in ('salesforce', 'hubspot')),
  pattern            text not null,
  target_field_hint  text not null,
  subtype_hint       text check (subtype_hint in ('mobile', 'home', 'work', 'fax', 'other')),
  notes              text,
  unique (source_system, pattern)
);

create table public.data_agent_chat_messages (
  id          uuid primary key default gen_random_uuid(),
  sub_account text not null references public.sub_accounts(code) on delete cascade,
  user_id     uuid references public.users(id) on delete set null,
  message     text not null check (length(trim(message)) > 0),
  created_at  timestamptz not null default now()
);
create index data_agent_chat_messages_sub_account_idx on public.data_agent_chat_messages (sub_account, created_at);

create table public.data_agent_prompts (
  id                 uuid primary key default gen_random_uuid(),
  migration_id       uuid not null references public.data_agent_migrations(id) on delete cascade,
  column_mapping_id  uuid references public.data_agent_column_mappings(id) on delete cascade,
  user_id            uuid references public.users(id) on delete set null,
  prompt_text        text not null,
  response_text      text,
  action_taken       jsonb,
  created_at         timestamptz not null default now()
);
create index data_agent_prompts_migration_idx on public.data_agent_prompts (migration_id);

-- ── Seed: curated source-system profiles (spec §6.2) ────────────────────────
insert into public.data_agent_source_profiles (source_system, pattern, target_field_hint, subtype_hint, notes) values
  ('salesforce', 'FirstName', 'firstName', null, null),
  ('salesforce', 'LastName', 'lastName', null, null),
  ('salesforce', 'Email', 'email', null, null),
  ('salesforce', 'Phone', 'phone', null, 'Primary phone'),
  ('salesforce', 'MobilePhone', 'custom_mobile_phone', 'mobile', null),
  ('salesforce', 'HomePhone', 'custom_home_phone', 'home', null),
  ('salesforce', 'OtherPhone', 'custom_other_phone', 'other', null),
  ('salesforce', 'Fax', 'custom_fax', 'fax', 'Flagged, not auto-mapped to primary phone'),
  ('salesforce', 'MailingStreet', 'address1', null, null),
  ('salesforce', 'MailingCity', 'city', null, null),
  ('salesforce', 'MailingState', 'state', null, null),
  ('salesforce', 'MailingPostalCode', 'postalCode', null, null),
  ('salesforce', 'MailingCountry', 'country', null, null),
  ('salesforce', 'DoNotCall', 'dnd_call', null, null),
  ('salesforce', 'HasOptedOutOfEmail', 'dnd_email', null, null),
  ('salesforce', 'Title', 'custom_title', null, null),
  ('salesforce', 'Description', 'custom_description', null, null),
  ('salesforce', 'LeadSource', 'custom_lead_source', null, null),
  ('hubspot', 'firstname', 'firstName', null, null),
  ('hubspot', 'lastname', 'lastName', null, null),
  ('hubspot', 'email', 'email', null, null),
  ('hubspot', 'phone', 'phone', null, 'Primary phone'),
  ('hubspot', 'mobilephone', 'custom_mobile_phone', 'mobile', null),
  ('hubspot', 'company', 'companyName', null, null),
  ('hubspot', 'jobtitle', 'custom_title', null, null),
  ('hubspot', 'address', 'address1', null, null),
  ('hubspot', 'city', 'city', null, null),
  ('hubspot', 'state', 'state', null, null),
  ('hubspot', 'zip', 'postalCode', null, null),
  ('hubspot', 'country', 'country', null, null),
  ('hubspot', 'website', 'website', null, null),
  ('hubspot', 'hs_email_optout', 'dnd_email', null, null),
  ('hubspot', 'lifecyclestage', 'custom_lifecycle_stage', null, null),
  ('hubspot', 'hs_lead_status', 'custom_lead_status', null, null);
  -- Note: HubSpot has no universal standard "do-not-call" property across
  -- portals (spec §6.2) — deliberately no hubspot DND-call row here; such a
  -- column is routed to the Claude tier rather than guessed.

-- ── Gate enforcement: the one place a migration can leave `mapping` ──────────
-- Re-validates server-side, never trusting a client-only check, that every
-- column is green (confirmed rule/profile/user match) or explicitly
-- ignored before flipping status (spec §6.4's hard gate).
create or replace function public.confirm_data_agent_migration(p_migration_id uuid)
  returns void
  language plpgsql security definer
  set search_path = public
as $$
declare
  v_sub_account text;
  v_blocking_count int;
  v_needs_country_code boolean;
  v_default_country_code text;
begin
  select sub_account, default_country_code into v_sub_account, v_default_country_code
    from public.data_agent_migrations where id = p_migration_id;
  if v_sub_account is null then
    raise exception 'Migration not found';
  end if;
  if not public.is_data_agent_member(v_sub_account) then
    raise exception 'Not authorized for this migration';
  end if;

  -- Blocking is purely a function of status, never target_type: a column
  -- the user explicitly chose to ignore is written back as status =
  -- 'mapped', target_type = 'ignored' (Task 10) — "ignored" is itself a
  -- resolved decision. target_type = 'ignored' also appears on a genuinely
  -- unmapped column (classifyColumn's no-match default, Task 6), but that
  -- case keeps status = 'unmapped' and still blocks correctly.
  select count(*) into v_blocking_count
    from public.data_agent_column_mappings
    where migration_id = p_migration_id
      and status in ('uncertain', 'unmapped');
  if v_blocking_count > 0 then
    raise exception 'Cannot confirm: % column(s) are not yet mapped or explicitly ignored', v_blocking_count;
  end if;

  -- A mapped phone column with absent/mixed country codes on its sample
  -- values needs an explicit default before any write that needs one —
  -- never a silent assumption (spec §6.1 step 3).
  select exists (
    select 1 from public.data_agent_column_mappings
    where migration_id = p_migration_id
      and status = 'mapped'
      and metadata->>'country_code_presence' in ('absent', 'mixed')
  ) into v_needs_country_code;
  if v_needs_country_code and coalesce(trim(v_default_country_code), '') = '' then
    raise exception 'Cannot confirm: a default country code is required for at least one phone column';
  end if;

  update public.data_agent_migrations
    set status = 'migrating', started_at = now()
    where id = p_migration_id and status = 'awaiting_confirmation';
  if not found then
    raise exception 'Migration is not awaiting confirmation';
  end if;
end;
$$;
revoke execute on function public.confirm_data_agent_migration(uuid) from public, anon;
grant execute on function public.confirm_data_agent_migration(uuid) to authenticated;

-- ── RLS ───────────────────────────────────────────────────────────────────
alter table public.data_agent_migrations enable row level security;
alter table public.data_agent_column_mappings enable row level security;
alter table public.data_agent_migration_records enable row level security;
alter table public.data_agent_qa_samples enable row level security;
alter table public.data_agent_source_profiles enable row level security;
alter table public.data_agent_chat_messages enable row level security;
alter table public.data_agent_prompts enable row level security;

create policy data_agent_migrations_select on public.data_agent_migrations
  for select using (public.is_data_agent_member(sub_account));
create policy data_agent_migrations_insert on public.data_agent_migrations
  for insert with check (public.is_data_agent_member(sub_account) and created_by = public.auth_user_app_id());
-- No client update/delete policy — status transitions and row edits only
-- ever happen via confirm_data_agent_migration(), the worker (service
-- role), or data-agent-upload (service role). Default-deny otherwise.

create policy data_agent_column_mappings_select on public.data_agent_column_mappings
  for select using (exists (select 1 from public.data_agent_migrations m where m.id = migration_id and public.is_data_agent_member(m.sub_account)));
create policy data_agent_column_mappings_update on public.data_agent_column_mappings
  for update using (exists (select 1 from public.data_agent_migrations m where m.id = migration_id and public.is_data_agent_member(m.sub_account) and m.status in ('mapping', 'awaiting_confirmation')))
  with check (exists (select 1 from public.data_agent_migrations m where m.id = migration_id and public.is_data_agent_member(m.sub_account) and m.status in ('mapping', 'awaiting_confirmation')));

create policy data_agent_migration_records_select on public.data_agent_migration_records
  for select using (exists (select 1 from public.data_agent_migrations m where m.id = migration_id and public.is_data_agent_member(m.sub_account)));

create policy data_agent_qa_samples_select on public.data_agent_qa_samples
  for select using (exists (
    select 1 from public.data_agent_migration_records r
    join public.data_agent_migrations m on m.id = r.migration_id
    where r.id = migration_record_id and public.is_data_agent_member(m.sub_account)));

-- Source profiles: non-sensitive curated reference data, readable by any
-- authenticated Data Agent member of some entitled sub-account; writable
-- only by Super-Admin (spec §4: "not user-editable through the UI in this
-- version").
create policy data_agent_source_profiles_select on public.data_agent_source_profiles
  for select to authenticated using (true);
create policy data_agent_source_profiles_write on public.data_agent_source_profiles
  for all using (public.auth_user_role() = 'Super-Admin') with check (public.auth_user_role() = 'Super-Admin');

create policy data_agent_chat_messages_select on public.data_agent_chat_messages
  for select using (public.is_data_agent_member(sub_account));
create policy data_agent_chat_messages_insert on public.data_agent_chat_messages
  for insert with check (public.is_data_agent_member(sub_account) and user_id = public.auth_user_app_id());

create policy data_agent_prompts_select on public.data_agent_prompts
  for select using (exists (select 1 from public.data_agent_migrations m where m.id = migration_id and public.is_data_agent_member(m.sub_account)));
create policy data_agent_prompts_insert on public.data_agent_prompts
  for insert with check (exists (select 1 from public.data_agent_migrations m where m.id = migration_id and public.is_data_agent_member(m.sub_account) and user_id = public.auth_user_app_id()));

-- ── Associate lock ───────────────────────────────────────────────────────────
create policy data_agent_migrations_deny_associates on public.data_agent_migrations
  as restrictive for all to authenticated using (not (select public.is_associate())) with check (not (select public.is_associate()));
create policy data_agent_column_mappings_deny_associates on public.data_agent_column_mappings
  as restrictive for all to authenticated using (not (select public.is_associate())) with check (not (select public.is_associate()));
create policy data_agent_migration_records_deny_associates on public.data_agent_migration_records
  as restrictive for all to authenticated using (not (select public.is_associate())) with check (not (select public.is_associate()));
create policy data_agent_qa_samples_deny_associates on public.data_agent_qa_samples
  as restrictive for all to authenticated using (not (select public.is_associate())) with check (not (select public.is_associate()));
create policy data_agent_source_profiles_deny_associates on public.data_agent_source_profiles
  as restrictive for all to authenticated using (not (select public.is_associate())) with check (not (select public.is_associate()));
create policy data_agent_chat_messages_deny_associates on public.data_agent_chat_messages
  as restrictive for all to authenticated using (not (select public.is_associate())) with check (not (select public.is_associate()));
create policy data_agent_prompts_deny_associates on public.data_agent_prompts
  as restrictive for all to authenticated using (not (select public.is_associate())) with check (not (select public.is_associate()));

-- ── Storage bucket for uploaded CSVs ────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit)
values ('data-agent-uploads', 'data-agent-uploads', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

-- Path convention: "<sub_account>/<migration_id>-<original filename>" — the
-- first folder segment is the sub_account code itself (text, not a uuid),
-- so is_data_agent_member can check it directly with no try_uuid cast.
drop policy if exists data_agent_uploads_obj_select on storage.objects;
create policy data_agent_uploads_obj_select on storage.objects
  for select to authenticated
  using (bucket_id = 'data-agent-uploads' and public.is_data_agent_member((storage.foldername(name))[1]));

drop policy if exists data_agent_uploads_obj_insert on storage.objects;
create policy data_agent_uploads_obj_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'data-agent-uploads' and public.is_data_agent_member((storage.foldername(name))[1]));
