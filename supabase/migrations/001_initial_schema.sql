-- Enable extensions
create extension if not exists "uuid-ossp";
create extension if not exists "pg_cron";

-- ============================================================
-- TABLES
-- ============================================================

create table if not exists public.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text unique not null,
  name               text not null,
  role               text not null check (role in ('Super-admin', 'Manager', 'Staff')),
  sub_account        text not null,
  manager_id         uuid references public.users(id) on delete set null,
  annual_leave       numeric not null default 0,
  time_off           numeric not null default 0,
  profile_image      text,
  reporting_time_in  text not null default '10:00',
  reporting_time_out text not null default '19:00',
  created_at         timestamptz not null default now()
);

create table if not exists public.time_logs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  date          date not null,
  clock_in      timestamptz not null,
  clock_out     timestamptz,
  status        text not null check (status in ('working', 'lunch', 'clocked_out')),
  total_minutes numeric not null default 0
);

create table if not exists public.screenshots (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references public.users(id) on delete cascade,
  url       text not null,
  timestamp timestamptz not null default now(),
  date      date not null
);

create table if not exists public.tasks (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  description text,
  creator_id  uuid not null references public.users(id) on delete cascade,
  assignee_id uuid references public.users(id) on delete set null,
  status      text not null default 'pending' check (status in ('pending', 'in_progress', 'completed')),
  due_date    timestamptz,
  recurring   text check (recurring in ('Daily', 'Weekly', 'Monthly')),
  created_at  timestamptz not null default now()
);

create table if not exists public.task_comments (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.tasks(id) on delete cascade,
  user_id     uuid not null references public.users(id) on delete cascade,
  body        text not null,
  attachments jsonb,
  created_at  timestamptz not null default now()
);

create table if not exists public.leave_requests (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  type       text not null check (type in ('Annual', 'Medical', 'Time-off')),
  start_date date not null,
  end_date   date not null,
  reason     text not null,
  status     text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);

create table if not exists public.public_holidays (
  id          uuid primary key default gen_random_uuid(),
  date        date not null,
  name        text not null,
  country     text not null check (country in ('SG', 'MY', 'PH')),
  sub_account text not null
);

create table if not exists public.documents (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  title      text not null,
  type       text not null check (type in ('Standard', 'Medical', 'ID')),
  url        text not null,
  size       numeric not null,
  created_at timestamptz not null default now()
);

create table if not exists public.kpis (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.users(id) on delete cascade,
  responsibilities jsonb not null default '[]',
  duties           jsonb not null default '[]',
  checklists       jsonb not null default '[]',
  updated_at       timestamptz not null default now()
);

create table if not exists public.subscriptions (
  id           uuid primary key default gen_random_uuid(),
  sub_account  text unique not null,
  plan         text not null default 'free' check (plan in ('free', 'basic', 'business', 'professional')),
  seats        integer not null default 1,
  status       text not null default 'trialing' check (status in ('active', 'cancelled', 'trialing')),
  billing_date timestamptz,
  created_at   timestamptz not null default now()
);

create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  type       text not null check (type in ('task_assigned', 'task_reply', 'leave_request', 'leave_approved')),
  message    text not null,
  read       boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.eod_reports (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  date       date not null,
  body       text not null,
  created_at timestamptz not null default now()
);

-- ============================================================
-- INDEXES
-- ============================================================

create index if not exists time_logs_user_date on public.time_logs (user_id, date);
create index if not exists screenshots_user_date on public.screenshots (user_id, date);
create index if not exists tasks_assignee_status on public.tasks (assignee_id, status);
create index if not exists notifications_user_read on public.notifications (user_id, read);

-- ============================================================
-- HELPER FUNCTIONS FOR RLS
-- ============================================================

create or replace function public.auth_user_sub_account()
returns text language sql security definer stable as $$
  select sub_account from public.users where id = auth.uid()
$$;

create or replace function public.auth_user_role()
returns text language sql security definer stable as $$
  select role from public.users where id = auth.uid()
$$;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table public.users enable row level security;
alter table public.time_logs enable row level security;
alter table public.screenshots enable row level security;
alter table public.tasks enable row level security;
alter table public.task_comments enable row level security;
alter table public.leave_requests enable row level security;
alter table public.public_holidays enable row level security;
alter table public.documents enable row level security;
alter table public.kpis enable row level security;
alter table public.subscriptions enable row level security;
alter table public.notifications enable row level security;
alter table public.eod_reports enable row level security;

-- users
create policy "users_select_same_sub_account" on public.users
  for select using (sub_account = public.auth_user_sub_account());
create policy "users_insert_super_admin" on public.users
  for insert with check (public.auth_user_role() = 'Super-admin');
create policy "users_update_own_or_admin" on public.users
  for update using (id = auth.uid() or public.auth_user_role() = 'Super-admin');
create policy "users_delete_super_admin" on public.users
  for delete using (public.auth_user_role() = 'Super-admin');

-- time_logs
create policy "time_logs_select" on public.time_logs
  for select using (user_id = auth.uid() or public.auth_user_role() in ('Super-admin', 'Manager'));
create policy "time_logs_insert_own" on public.time_logs
  for insert with check (user_id = auth.uid());
create policy "time_logs_update_own" on public.time_logs
  for update using (user_id = auth.uid());

-- screenshots
create policy "screenshots_select" on public.screenshots
  for select using (user_id = auth.uid() or public.auth_user_role() in ('Super-admin', 'Manager'));
create policy "screenshots_insert_own" on public.screenshots
  for insert with check (user_id = auth.uid());
create policy "screenshots_delete" on public.screenshots
  for delete using (user_id = auth.uid() or public.auth_user_role() = 'Super-admin');

-- tasks
create policy "tasks_select" on public.tasks
  for select using (assignee_id = auth.uid() or creator_id = auth.uid() or public.auth_user_role() in ('Super-admin', 'Manager'));
create policy "tasks_insert" on public.tasks
  for insert with check (creator_id = auth.uid());
create policy "tasks_update" on public.tasks
  for update using (creator_id = auth.uid() or assignee_id = auth.uid() or public.auth_user_role() in ('Super-admin', 'Manager'));
create policy "tasks_delete" on public.tasks
  for delete using (creator_id = auth.uid() or public.auth_user_role() in ('Super-admin', 'Manager'));

-- task_comments
create policy "task_comments_select" on public.task_comments
  for select using (user_id = auth.uid() or public.auth_user_role() in ('Super-admin', 'Manager'));
create policy "task_comments_insert" on public.task_comments
  for insert with check (user_id = auth.uid());

-- leave_requests
create policy "leave_select" on public.leave_requests
  for select using (user_id = auth.uid() or public.auth_user_role() in ('Super-admin', 'Manager'));
create policy "leave_insert_own" on public.leave_requests
  for insert with check (user_id = auth.uid());
create policy "leave_update_manager" on public.leave_requests
  for update using (public.auth_user_role() in ('Super-admin', 'Manager'));

-- public_holidays
create policy "holidays_select" on public.public_holidays
  for select using (sub_account = public.auth_user_sub_account());
create policy "holidays_write_admin" on public.public_holidays
  for all using (public.auth_user_role() = 'Super-admin');

-- documents
create policy "documents_select" on public.documents
  for select using (user_id = auth.uid() or public.auth_user_role() in ('Super-admin', 'Manager'));
create policy "documents_insert" on public.documents
  for insert with check (user_id = auth.uid() or public.auth_user_role() in ('Super-admin', 'Manager'));
create policy "documents_delete" on public.documents
  for delete using (user_id = auth.uid() or public.auth_user_role() = 'Super-admin');

-- kpis
create policy "kpis_select" on public.kpis
  for select using (user_id = auth.uid() or public.auth_user_role() in ('Super-admin', 'Manager'));
create policy "kpis_write_own" on public.kpis
  for all using (user_id = auth.uid());

-- subscriptions
create policy "subscriptions_select" on public.subscriptions
  for select using (sub_account = public.auth_user_sub_account());
create policy "subscriptions_write_admin" on public.subscriptions
  for all using (public.auth_user_role() = 'Super-admin');

-- notifications
create policy "notifications_select_own" on public.notifications
  for select using (user_id = auth.uid());
create policy "notifications_update_own" on public.notifications
  for update using (user_id = auth.uid());
create policy "notifications_insert" on public.notifications
  for insert with check (true);

-- eod_reports
create policy "eod_select" on public.eod_reports
  for select using (user_id = auth.uid() or public.auth_user_role() in ('Super-admin', 'Manager'));
create policy "eod_insert_own" on public.eod_reports
  for insert with check (user_id = auth.uid());

-- ============================================================
-- STORAGE BUCKETS
-- ============================================================

insert into storage.buckets (id, name, public)
values
  ('screenshots', 'screenshots', false),
  ('documents',   'documents',   false),
  ('avatars',     'avatars',     true)
on conflict (id) do nothing;

create policy "screenshots_upload" on storage.objects
  for insert with check (bucket_id = 'screenshots' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "screenshots_read" on storage.objects
  for select using (bucket_id = 'screenshots' and (auth.uid()::text = (storage.foldername(name))[1] or public.auth_user_role() in ('Super-admin', 'Manager')));
create policy "screenshots_delete_obj" on storage.objects
  for delete using (bucket_id = 'screenshots' and (auth.uid()::text = (storage.foldername(name))[1] or public.auth_user_role() = 'Super-admin'));

create policy "documents_upload" on storage.objects
  for insert with check (bucket_id = 'documents' and auth.role() = 'authenticated');
create policy "documents_read" on storage.objects
  for select using (bucket_id = 'documents' and (auth.uid()::text = (storage.foldername(name))[1] or public.auth_user_role() in ('Super-admin', 'Manager')));

create policy "avatars_public_read" on storage.objects
  for select using (bucket_id = 'avatars');
create policy "avatars_upload" on storage.objects
  for insert with check (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);

-- ============================================================
-- AUTO-PURGE: screenshots older than 30 days (every Sunday 00:00 UTC)
-- ============================================================

select cron.schedule(
  'purge-old-screenshots',
  '0 0 * * 0',
  $$ delete from public.screenshots where timestamp < now() - interval '30 days'; $$
);

-- ============================================================
-- REALTIME
-- ============================================================

alter publication supabase_realtime add table public.time_logs;
alter publication supabase_realtime add table public.notifications;
