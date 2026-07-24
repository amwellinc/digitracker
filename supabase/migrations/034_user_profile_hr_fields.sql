-- Migration 034: Extended user profile — Appointed As, Location, Emergency
-- Contact, and Department/Team (created per sub-account, with one or more
-- Managers assignable to each).
--
-- Ownership split (per product decision): Appointed As, Department/Team, and
-- Manager stay Admin-managed (existing Settings → Users screens). Physical
-- Address and Emergency Contact are self-edited by each user from My Profile.
-- Remote Address (last_ip_address) is never manually entered — it's captured
-- server-side by the capture-ip Edge Function on every sign-in.

alter table public.users
  add column if not exists appointed_as             text,
  add column if not exists address_line1            text,
  add column if not exists address_line2             text,
  add column if not exists address_city              text,
  add column if not exists address_pin_code          text,
  add column if not exists last_ip_address           text,
  add column if not exists last_ip_captured_at       timestamptz,
  add column if not exists emergency_contact_name    text,
  add column if not exists emergency_contact_phone   text,
  add column if not exists department_id             uuid;

-- ── departments (Team/Department, created per sub-account) ─────────────────

create table if not exists public.departments (
  id           uuid primary key default gen_random_uuid(),
  sub_account  text not null references public.sub_accounts(code) on delete cascade,
  name         text not null,
  created_at   timestamptz not null default now(),
  unique (sub_account, name)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'users_department_id_fkey'
  ) then
    alter table public.users
      add constraint users_department_id_fkey
      foreign key (department_id) references public.departments(id) on delete set null;
  end if;
end $$;

-- ── department_managers (a department can have multiple Managers) ──────────

create table if not exists public.department_managers (
  id             uuid primary key default gen_random_uuid(),
  department_id  uuid not null references public.departments(id) on delete cascade,
  manager_id     uuid not null references public.users(id) on delete cascade,
  created_at     timestamptz not null default now(),
  unique (department_id, manager_id)
);

alter table public.departments enable row level security;
alter table public.department_managers enable row level security;

-- Anyone in the sub-account can read the department list (needed to display
-- "Department / Team" on a profile); only Admin/Super-Admin can manage it.
drop policy if exists "departments_select" on public.departments;
create policy "departments_select" on public.departments
  for select using (
    public.auth_user_role() = 'Super-Admin'
    or sub_account = public.auth_user_sub_account()
  );

drop policy if exists "departments_write" on public.departments;
create policy "departments_write" on public.departments
  for all using (
    public.auth_user_role() = 'Super-Admin'
    or (public.auth_user_role() = 'Admin' and sub_account = public.auth_user_sub_account())
  ) with check (
    public.auth_user_role() = 'Super-Admin'
    or (public.auth_user_role() = 'Admin' and sub_account = public.auth_user_sub_account())
  );

drop policy if exists "department_managers_select" on public.department_managers;
create policy "department_managers_select" on public.department_managers
  for select using (
    exists (
      select 1 from public.departments d
      where d.id = department_managers.department_id
        and (public.auth_user_role() = 'Super-Admin' or d.sub_account = public.auth_user_sub_account())
    )
  );

drop policy if exists "department_managers_write" on public.department_managers;
create policy "department_managers_write" on public.department_managers
  for all using (
    exists (
      select 1 from public.departments d
      where d.id = department_managers.department_id
        and (
          public.auth_user_role() = 'Super-Admin'
          or (public.auth_user_role() = 'Admin' and d.sub_account = public.auth_user_sub_account())
        )
    )
  ) with check (
    exists (
      select 1 from public.departments d
      where d.id = department_managers.department_id
        and (
          public.auth_user_role() = 'Super-Admin'
          or (public.auth_user_role() = 'Admin' and d.sub_account = public.auth_user_sub_account())
        )
    )
  );
