-- Migration 008: Role Overhaul + Sub-Accounts + Country/Time-off Improvements
-- 1. 'Super-admin' (sub-account admin) renamed to 'Admin'
-- 2. New 'Super-Admin' role for SaaS platform admins
-- 3. sub_accounts management table
-- 4. subscriptions extended with billing_cycle, company_name, notes
-- 5. All RLS policies updated to new role names

-- ─── 1. Rename existing Super-admin → Admin (data first, constraint second) ──

alter table public.users
  drop constraint if exists users_role_check;

update public.users
set role = 'Admin'
where role = 'Super-admin';

alter table public.users
  add constraint users_role_check
    check (role in ('Super-Admin', 'Admin', 'Manager', 'Staff'));

-- ─── 2. Create sub_accounts table ────────────────────────────────────────────

create table if not exists public.sub_accounts (
  code          text primary key,
  company_name  text not null default '',
  admin_email   text,
  plan          text not null default 'free'
    check (plan in ('free', 'basic', 'business', 'professional')),
  seats         int  not null default 3,
  status        text not null default 'active'
    check (status in ('active', 'trialing', 'cancelled', 'suspended')),
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Seed from existing users (Admin users first, then any remaining sub-accounts)
insert into public.sub_accounts (code, company_name, admin_email)
select distinct on (u.sub_account)
  u.sub_account,
  u.sub_account,
  u.email
from public.users u
where u.sub_account != '__saas__'
  and u.role = 'Admin'
order by u.sub_account, u.created_at asc
on conflict (code) do nothing;

insert into public.sub_accounts (code, company_name)
select distinct sub_account, sub_account
from public.users
where sub_account != '__saas__'
on conflict (code) do nothing;

-- Sync plan/seats from subscriptions
update public.sub_accounts sa
set plan  = s.plan,
    seats = s.seats
from public.subscriptions s
where s.sub_account = sa.code;

-- ─── 3. Extend subscriptions table ───────────────────────────────────────────

alter table public.subscriptions
  add column if not exists billing_cycle text not null default 'monthly'
    check (billing_cycle in ('monthly', 'annual')),
  add column if not exists company_name  text,
  add column if not exists notes         text;

-- ─── 4. RLS for sub_accounts ─────────────────────────────────────────────────

alter table public.sub_accounts enable row level security;

drop policy if exists "sub_accounts_select"            on public.sub_accounts;
drop policy if exists "sub_accounts_write_super_admin" on public.sub_accounts;

create policy "sub_accounts_select" on public.sub_accounts
  for select using (
    code = public.auth_user_sub_account()
    or public.auth_user_role() = 'Super-Admin'
  );

create policy "sub_accounts_write_super_admin" on public.sub_accounts
  for all using (public.auth_user_role() = 'Super-Admin')
  with check (public.auth_user_role() = 'Super-Admin');

-- ─── 5. Recreate all RLS policies with updated role names ────────────────────

-- ── users ──
drop policy if exists "users_insert_super_admin"       on public.users;
drop policy if exists "users_delete_super_admin"       on public.users;
drop policy if exists "users_insert_admin"             on public.users;
drop policy if exists "users_delete_admin"             on public.users;
drop policy if exists "users_select_same_sub_account"  on public.users;
drop policy if exists "users_update_own_or_admin"      on public.users;

create policy "users_select_same_sub_account" on public.users
  for select using (
    sub_account = public.auth_user_sub_account()
    or public.auth_user_role() = 'Super-Admin'
  );

create policy "users_insert_admin" on public.users
  for insert with check (
    public.auth_user_role() in ('Admin', 'Super-Admin')
  );

create policy "users_update_own_or_admin" on public.users
  for update using (
    id = auth.uid()
    or public.auth_user_role() in ('Admin', 'Super-Admin')
  );

create policy "users_delete_admin" on public.users
  for delete using (
    public.auth_user_role() in ('Admin', 'Super-Admin')
  );

-- ── time_logs ──
drop policy if exists "time_logs_select"    on public.time_logs;
drop policy if exists "time_logs_update_own" on public.time_logs;
drop policy if exists "time_logs_update"    on public.time_logs;

create policy "time_logs_select" on public.time_logs
  for select using (
    user_id = auth.uid()
    or public.auth_user_role() in ('Admin', 'Manager', 'Super-Admin')
  );

create policy "time_logs_update" on public.time_logs
  for update using (
    user_id = auth.uid()
    or public.auth_user_role() in ('Admin', 'Super-Admin')
  );

-- ── screenshots ──
drop policy if exists "screenshots_select"   on public.screenshots;
drop policy if exists "screenshots_delete"   on public.screenshots;

create policy "screenshots_select" on public.screenshots
  for select using (
    user_id = auth.uid()
    or public.auth_user_role() in ('Admin', 'Manager', 'Super-Admin')
  );

create policy "screenshots_delete" on public.screenshots
  for delete using (
    user_id = auth.uid()
    or public.auth_user_role() in ('Admin', 'Super-Admin')
  );

-- ── tasks ──
drop policy if exists "tasks_select"    on public.tasks;
drop policy if exists "tasks_insert"    on public.tasks;
drop policy if exists "tasks_update"    on public.tasks;
drop policy if exists "tasks_delete"    on public.tasks;

create policy "tasks_select" on public.tasks
  for select using (
    assignee_id = auth.uid()
    or creator_id = auth.uid()
    or public.auth_user_role() in ('Admin', 'Manager', 'Super-Admin')
  );

create policy "tasks_insert" on public.tasks
  for insert with check (
    creator_id = auth.uid()
    or public.auth_user_role() in ('Admin', 'Manager', 'Super-Admin')
  );

create policy "tasks_update" on public.tasks
  for update using (
    creator_id = auth.uid()
    or assignee_id = auth.uid()
    or public.auth_user_role() in ('Admin', 'Manager', 'Super-Admin')
  );

create policy "tasks_delete" on public.tasks
  for delete using (
    creator_id = auth.uid()
    or public.auth_user_role() in ('Admin', 'Manager', 'Super-Admin')
  );

-- ── task_assignees ──
drop policy if exists "task_assignees_select" on public.task_assignees;
drop policy if exists "task_assignees_insert" on public.task_assignees;
drop policy if exists "task_assignees_delete" on public.task_assignees;
drop policy if exists "task_assignees_write"  on public.task_assignees;

create policy "task_assignees_select" on public.task_assignees
  for select using (
    user_id = auth.uid()
    or public.auth_user_role() in ('Admin', 'Manager', 'Super-Admin')
  );

create policy "task_assignees_write" on public.task_assignees
  for all using (
    public.auth_user_role() in ('Admin', 'Manager', 'Super-Admin')
  );

-- ── task_comments ──
drop policy if exists "task_comments_select"  on public.task_comments;
drop policy if exists "task_comments_insert"  on public.task_comments;

create policy "task_comments_select" on public.task_comments
  for select using (
    user_id = auth.uid()
    or public.auth_user_role() in ('Admin', 'Manager', 'Super-Admin')
  );

create policy "task_comments_insert" on public.task_comments
  for insert with check (user_id = auth.uid());

-- ── leave_requests ──
drop policy if exists "leave_select"         on public.leave_requests;
drop policy if exists "leave_update_manager" on public.leave_requests;
drop policy if exists "leaves_select"        on public.leave_requests;
drop policy if exists "leaves_update"        on public.leave_requests;

create policy "leaves_select" on public.leave_requests
  for select using (
    user_id = auth.uid()
    or public.auth_user_role() in ('Admin', 'Manager', 'Super-Admin')
  );

create policy "leaves_update" on public.leave_requests
  for update using (
    user_id = auth.uid()
    or public.auth_user_role() in ('Admin', 'Manager', 'Super-Admin')
  );

-- ── notifications ──
drop policy if exists "notif_select"             on public.notifications;
drop policy if exists "notifications_select_own" on public.notifications;

create policy "notifications_select_own" on public.notifications
  for select using (
    user_id = auth.uid()
    or public.auth_user_role() in ('Admin', 'Manager', 'Super-Admin')
  );

-- ── eod_reports ──
drop policy if exists "eod_select" on public.eod_reports;

create policy "eod_select" on public.eod_reports
  for select using (
    user_id = auth.uid()
    or public.auth_user_role() in ('Admin', 'Manager', 'Super-Admin')
  );

-- ── subscriptions ──
drop policy if exists "subscriptions_select"            on public.subscriptions;
drop policy if exists "subscriptions_write_super_admin" on public.subscriptions;
drop policy if exists "subscriptions_write_admin"       on public.subscriptions;

create policy "subscriptions_select" on public.subscriptions
  for select using (
    sub_account = public.auth_user_sub_account()
    or public.auth_user_role() = 'Super-Admin'
  );

create policy "subscriptions_write_admin" on public.subscriptions
  for all using (
    public.auth_user_role() in ('Admin', 'Super-Admin')
  )
  with check (
    public.auth_user_role() in ('Admin', 'Super-Admin')
  );

-- ── public_holidays ──
drop policy if exists "holidays_write_admin" on public.public_holidays;

create policy "holidays_write_admin" on public.public_holidays
  for all using (
    public.auth_user_role() in ('Admin', 'Super-Admin')
  );

-- ── kpis ──
drop policy if exists "kpis_select"  on public.kpis;
drop policy if exists "kpis_insert"  on public.kpis;
drop policy if exists "kpis_update"  on public.kpis;
drop policy if exists "kpis_delete"  on public.kpis;

create policy "kpis_select" on public.kpis
  for select using (
    user_id = auth.uid()
    or public.auth_user_role() in ('Admin', 'Manager', 'Super-Admin')
  );

create policy "kpis_insert" on public.kpis
  for insert with check (
    public.auth_user_role() in ('Admin', 'Manager', 'Super-Admin')
  );

create policy "kpis_update" on public.kpis
  for update using (
    public.auth_user_role() in ('Admin', 'Manager', 'Super-Admin')
  );

-- ── kpi_daily_logs ──
drop policy if exists "kpi_daily_logs_select"  on public.kpi_daily_logs;

create policy "kpi_daily_logs_select" on public.kpi_daily_logs
  for select using (
    user_id = auth.uid()
    or public.auth_user_role() in ('Admin', 'Manager', 'Super-Admin')
  );

-- ── documents (DB table) ──
drop policy if exists "documents_select"  on public.documents;
drop policy if exists "documents_insert"  on public.documents;
drop policy if exists "documents_delete"  on public.documents;

create policy "documents_select" on public.documents
  for select using (
    user_id = auth.uid()
    or public.auth_user_role() in ('Admin', 'Manager', 'Super-Admin')
  );

create policy "documents_insert" on public.documents
  for insert with check (
    user_id = auth.uid()
    or public.auth_user_role() in ('Admin', 'Manager', 'Super-Admin')
  );

create policy "documents_delete" on public.documents
  for delete using (
    user_id = auth.uid()
    or public.auth_user_role() in ('Admin', 'Manager', 'Super-Admin')
  );

-- ── storage.objects — screenshots ──
drop policy if exists "screenshots_read"       on storage.objects;
drop policy if exists "screenshots_delete_obj" on storage.objects;

create policy "screenshots_read" on storage.objects
  for select using (
    bucket_id = 'screenshots'
    and (
      auth.uid()::text = (storage.foldername(name))[1]
      or public.auth_user_role() in ('Admin', 'Manager', 'Super-Admin')
    )
  );

create policy "screenshots_delete_obj" on storage.objects
  for delete using (
    bucket_id = 'screenshots'
    and (
      auth.uid()::text = (storage.foldername(name))[1]
      or public.auth_user_role() in ('Admin', 'Super-Admin')
    )
  );

-- ── storage.objects — documents ──
drop policy if exists "documents_upload"  on storage.objects;
drop policy if exists "documents_read"    on storage.objects;
drop policy if exists "documents_delete"  on storage.objects;

create policy "documents_upload" on storage.objects
  for insert with check (
    bucket_id = 'documents'
    and (
      auth.uid()::text = (storage.foldername(name))[1]
      or public.auth_user_role() in ('Admin', 'Manager', 'Super-Admin')
    )
  );

create policy "documents_read" on storage.objects
  for select using (
    bucket_id = 'documents'
    and (
      auth.uid()::text = (storage.foldername(name))[1]
      or public.auth_user_role() in ('Admin', 'Manager', 'Super-Admin')
    )
  );

create policy "documents_delete" on storage.objects
  for delete using (
    bucket_id = 'documents'
    and (
      auth.uid()::text = (storage.foldername(name))[1]
      or public.auth_user_role() in ('Admin', 'Manager', 'Super-Admin')
    )
  );

-- ─── 6. Enable Realtime for sub_accounts ─────────────────────────────────────

alter publication supabase_realtime add table public.sub_accounts;
