-- Migration 026: Full sub-account isolation audit + Manager downline scoping
--
-- Three separate fixes, all requested together:
--
-- 1. Sub-account isolation (audit finding): several "Admin/Manager can see
--    everything" RLS bypass clauses across the schema never actually checked
--    that the target row belonged to the caller's own sub-account — the same
--    gap fixed for documents in migration 025 existed in users (insert/update/
--    delete), subscriptions, public_holidays, time_logs, screenshots, tasks,
--    task_assignees, task_comments, leave_requests, notifications, eod_reports,
--    kpis, and kpi_daily_logs. All of those are tightened here.
--
-- 2. Manager downline scoping: a Manager may report to another Manager, so
--    "the users assigned under him" is transitive, not just manager_id = self.
--    is_in_caller_downline() and get_manager_downline() walk the manager_id
--    chain recursively (depth-capped at 20 to guard against bad data forming
--    a cycle). Every policy that granted Manager the same reach as Admin now
--    scopes Manager to this downline instead.
--
-- 3. HR documents: Managers no longer get any bypass at all (own documents
--    only) — this narrows what migration 025 granted. See HRDocumentsPage.tsx
--    for the matching UI change ("No access as Manager").

-- ── New helper functions ──────────────────────────────────────────────────────

create or replace function public.is_in_caller_downline(p_target_user_id uuid)
  returns boolean
  language sql security definer stable
as $$
  with recursive downline_ids as (
    select id, 1 as depth
      from public.users
     where manager_id = public.auth_user_app_id()
    union all
    select u.id, d.depth + 1
      from public.users u
      join downline_ids d on u.manager_id = d.id
     where d.depth < 20
  )
  select exists (select 1 from downline_ids where id = p_target_user_id)
$$;

create or replace function public.get_manager_downline(p_manager_id uuid default null)
  returns setof public.users
  language sql security definer stable
as $$
  with recursive downline_ids as (
    select id, 1 as depth
      from public.users
     where manager_id = coalesce(p_manager_id, public.auth_user_app_id())
    union all
    select u.id, d.depth + 1
      from public.users u
      join downline_ids d on u.manager_id = d.id
     where d.depth < 20
  )
  select u.* from public.users u join downline_ids d on d.id = u.id order by u.name
$$;

grant execute on function public.get_manager_downline(uuid) to authenticated;

-- Text overload for storage.objects policies, where the target id comes from a
-- folder-name path segment and isn't guaranteed to be a well-formed uuid.
-- Never throws — an unparseable id just means "not in my downline".
create or replace function public.is_in_caller_downline(p_target_user_id text)
  returns boolean
  language plpgsql security definer stable
as $$
begin
  return public.is_in_caller_downline(p_target_user_id::uuid);
exception when others then
  return false;
end;
$$;

-- ── users ──────────────────────────────────────────────────────────────────────
-- Admin insert/update/delete were role-gated only — no check that the target
-- row (or, for insert, the new row) stayed inside the Admin's own sub-account.

drop policy if exists "users_insert_admin"        on public.users;
drop policy if exists "users_update_own_or_admin" on public.users;
drop policy if exists "users_delete_admin"        on public.users;

create policy "users_insert_admin" on public.users
  for insert with check (
    public.auth_user_role() = 'Super-Admin'
    or (public.auth_user_role() = 'Admin' and sub_account = public.auth_user_sub_account())
  );

create policy "users_update_own_or_admin" on public.users
  for update using (
    id = public.auth_user_app_id()
    or public.auth_user_role() = 'Super-Admin'
    or (public.auth_user_role() = 'Admin' and sub_account = public.auth_user_sub_account())
  );

create policy "users_delete_admin" on public.users
  for delete using (
    public.auth_user_role() = 'Super-Admin'
    or (public.auth_user_role() = 'Admin' and sub_account = public.auth_user_sub_account())
  );

-- ── documents (DB table) — Manager access removed entirely ─────────────────────

drop policy if exists "documents_select" on public.documents;
drop policy if exists "documents_insert" on public.documents;
drop policy if exists "documents_delete" on public.documents;

create policy "documents_select" on public.documents
  for select using (
    user_id = public.auth_user_app_id()
    or public.auth_user_role() = 'Super-Admin'
    or (public.auth_user_role() = 'Admin' and public.same_sub_account_as_caller(user_id::text))
  );

create policy "documents_insert" on public.documents
  for insert with check (
    user_id = public.auth_user_app_id()
    or public.auth_user_role() = 'Super-Admin'
    or (public.auth_user_role() = 'Admin' and public.same_sub_account_as_caller(user_id::text))
  );

create policy "documents_delete" on public.documents
  for delete using (
    user_id = public.auth_user_app_id()
    or public.auth_user_role() = 'Super-Admin'
    or (public.auth_user_role() = 'Admin' and public.same_sub_account_as_caller(user_id::text))
  );

-- ── storage.objects — documents bucket — Manager access removed entirely ──────

drop policy if exists "documents_upload" on storage.objects;
drop policy if exists "documents_read"   on storage.objects;
drop policy if exists "documents_delete" on storage.objects;

create policy "documents_upload" on storage.objects
  for insert with check (
    bucket_id = 'documents'
    and (
      public.auth_user_app_id()::text = (storage.foldername(name))[1]
      or public.auth_user_role() = 'Super-Admin'
      or (public.auth_user_role() = 'Admin' and public.same_sub_account_as_caller((storage.foldername(name))[1]))
    )
  );

create policy "documents_read" on storage.objects
  for select using (
    bucket_id = 'documents'
    and (
      public.auth_user_app_id()::text = (storage.foldername(name))[1]
      or public.auth_user_role() = 'Super-Admin'
      or (public.auth_user_role() = 'Admin' and public.same_sub_account_as_caller((storage.foldername(name))[1]))
    )
  );

create policy "documents_delete" on storage.objects
  for delete using (
    bucket_id = 'documents'
    and (
      public.auth_user_app_id()::text = (storage.foldername(name))[1]
      or public.auth_user_role() = 'Super-Admin'
      or (public.auth_user_role() = 'Admin' and public.same_sub_account_as_caller((storage.foldername(name))[1]))
    )
  );

-- ── time_logs ─────────────────────────────────────────────────────────────────

drop policy if exists "time_logs_select" on public.time_logs;
drop policy if exists "time_logs_update" on public.time_logs;

create policy "time_logs_select" on public.time_logs
  for select using (
    user_id = public.auth_user_app_id()
    or public.auth_user_role() = 'Super-Admin'
    or (public.auth_user_role() = 'Admin' and public.same_sub_account_as_caller(user_id::text))
    or (public.auth_user_role() = 'Manager' and public.is_in_caller_downline(user_id))
  );

create policy "time_logs_update" on public.time_logs
  for update using (
    user_id = public.auth_user_app_id()
    or public.auth_user_role() = 'Super-Admin'
    or (public.auth_user_role() = 'Admin' and public.same_sub_account_as_caller(user_id::text))
  );

-- ── screenshots (DB table) ────────────────────────────────────────────────────

drop policy if exists "screenshots_select" on public.screenshots;
drop policy if exists "screenshots_delete" on public.screenshots;

create policy "screenshots_select" on public.screenshots
  for select using (
    user_id = public.auth_user_app_id()
    or public.auth_user_role() = 'Super-Admin'
    or (public.auth_user_role() = 'Admin' and public.same_sub_account_as_caller(user_id::text))
    or (public.auth_user_role() = 'Manager' and public.is_in_caller_downline(user_id))
  );

create policy "screenshots_delete" on public.screenshots
  for delete using (
    user_id = public.auth_user_app_id()
    or public.auth_user_role() = 'Super-Admin'
    or (public.auth_user_role() = 'Admin' and public.same_sub_account_as_caller(user_id::text))
  );

-- ── storage.objects — screenshots bucket ────────────────────────────────────────

drop policy if exists "screenshots_read"       on storage.objects;
drop policy if exists "screenshots_delete_obj" on storage.objects;

create policy "screenshots_read" on storage.objects
  for select using (
    bucket_id = 'screenshots'
    and (
      public.auth_user_app_id()::text = (storage.foldername(name))[1]
      or public.auth_user_role() = 'Super-Admin'
      or (public.auth_user_role() = 'Admin' and public.same_sub_account_as_caller((storage.foldername(name))[1]))
      or (public.auth_user_role() = 'Manager' and public.is_in_caller_downline((storage.foldername(name))[1]))
    )
  );

create policy "screenshots_delete_obj" on storage.objects
  for delete using (
    bucket_id = 'screenshots'
    and (
      public.auth_user_app_id()::text = (storage.foldername(name))[1]
      or public.auth_user_role() = 'Super-Admin'
      or (public.auth_user_role() = 'Admin' and public.same_sub_account_as_caller((storage.foldername(name))[1]))
    )
  );

-- ── tasks ────────────────────────────────────────────────────────────────────

drop policy if exists "tasks_select" on public.tasks;
drop policy if exists "tasks_insert" on public.tasks;
drop policy if exists "tasks_update" on public.tasks;
drop policy if exists "tasks_delete" on public.tasks;

create policy "tasks_select" on public.tasks
  for select using (
    creator_id = public.auth_user_app_id()
    or assignee_id = public.auth_user_app_id()
    or public.auth_user_role() = 'Super-Admin'
    or (
      public.auth_user_role() = 'Admin'
      and (public.same_sub_account_as_caller(creator_id::text) or public.same_sub_account_as_caller(assignee_id::text))
    )
    or (
      public.auth_user_role() = 'Manager'
      and (public.is_in_caller_downline(creator_id) or public.is_in_caller_downline(assignee_id))
    )
  );

create policy "tasks_insert" on public.tasks
  for insert with check (
    creator_id = public.auth_user_app_id()
    or public.auth_user_role() = 'Super-Admin'
    or (public.auth_user_role() = 'Admin' and public.same_sub_account_as_caller(creator_id::text))
    or (public.auth_user_role() = 'Manager' and public.is_in_caller_downline(creator_id))
  );

create policy "tasks_update" on public.tasks
  for update using (
    creator_id = public.auth_user_app_id()
    or assignee_id = public.auth_user_app_id()
    or public.auth_user_role() = 'Super-Admin'
    or (
      public.auth_user_role() = 'Admin'
      and (public.same_sub_account_as_caller(creator_id::text) or public.same_sub_account_as_caller(assignee_id::text))
    )
    or (
      public.auth_user_role() = 'Manager'
      and (public.is_in_caller_downline(creator_id) or public.is_in_caller_downline(assignee_id))
    )
  );

create policy "tasks_delete" on public.tasks
  for delete using (
    creator_id = public.auth_user_app_id()
    or public.auth_user_role() = 'Super-Admin'
    or (public.auth_user_role() = 'Admin' and public.same_sub_account_as_caller(creator_id::text))
    or (public.auth_user_role() = 'Manager' and public.is_in_caller_downline(creator_id))
  );

-- ── task_assignees ────────────────────────────────────────────────────────────

drop policy if exists "task_assignees_select" on public.task_assignees;
drop policy if exists "task_assignees_write"  on public.task_assignees;

create policy "task_assignees_select" on public.task_assignees
  for select using (
    user_id = public.auth_user_app_id()
    or public.auth_user_role() = 'Super-Admin'
    or (public.auth_user_role() = 'Admin' and public.same_sub_account_as_caller(user_id::text))
    or (public.auth_user_role() = 'Manager' and public.is_in_caller_downline(user_id))
  );

create policy "task_assignees_write" on public.task_assignees
  for all using (
    public.auth_user_role() = 'Super-Admin'
    or (public.auth_user_role() = 'Admin' and public.same_sub_account_as_caller(user_id::text))
    or (public.auth_user_role() = 'Manager' and public.is_in_caller_downline(user_id))
  );

-- ── task_comments ─────────────────────────────────────────────────────────────

drop policy if exists "task_comments_select" on public.task_comments;

create policy "task_comments_select" on public.task_comments
  for select using (
    user_id = public.auth_user_app_id()
    or public.auth_user_role() = 'Super-Admin'
    or (public.auth_user_role() = 'Admin' and public.same_sub_account_as_caller(user_id::text))
    or (public.auth_user_role() = 'Manager' and public.is_in_caller_downline(user_id))
  );

-- ── leave_requests ────────────────────────────────────────────────────────────

drop policy if exists "leaves_select" on public.leave_requests;
drop policy if exists "leaves_update" on public.leave_requests;

create policy "leaves_select" on public.leave_requests
  for select using (
    user_id = public.auth_user_app_id()
    or public.auth_user_role() = 'Super-Admin'
    or (public.auth_user_role() = 'Admin' and public.same_sub_account_as_caller(user_id::text))
    or (public.auth_user_role() = 'Manager' and public.is_in_caller_downline(user_id))
  );

create policy "leaves_update" on public.leave_requests
  for update using (
    user_id = public.auth_user_app_id()
    or public.auth_user_role() = 'Super-Admin'
    or (public.auth_user_role() = 'Admin' and public.same_sub_account_as_caller(user_id::text))
    or (public.auth_user_role() = 'Manager' and public.is_in_caller_downline(user_id))
  );

-- ── notifications ─────────────────────────────────────────────────────────────

drop policy if exists "notifications_select_own" on public.notifications;

create policy "notifications_select_own" on public.notifications
  for select using (
    user_id = public.auth_user_app_id()
    or public.auth_user_role() = 'Super-Admin'
    or (public.auth_user_role() = 'Admin' and public.same_sub_account_as_caller(user_id::text))
    or (public.auth_user_role() = 'Manager' and public.is_in_caller_downline(user_id))
  );

-- ── eod_reports ───────────────────────────────────────────────────────────────

drop policy if exists "eod_select" on public.eod_reports;

create policy "eod_select" on public.eod_reports
  for select using (
    user_id = public.auth_user_app_id()
    or public.auth_user_role() = 'Super-Admin'
    or (public.auth_user_role() = 'Admin' and public.same_sub_account_as_caller(user_id::text))
    or (public.auth_user_role() = 'Manager' and public.is_in_caller_downline(user_id))
  );

-- ── kpis ─────────────────────────────────────────────────────────────────────

drop policy if exists "kpis_select" on public.kpis;
drop policy if exists "kpis_insert" on public.kpis;
drop policy if exists "kpis_update" on public.kpis;
drop policy if exists "kpis_delete" on public.kpis;

create policy "kpis_select" on public.kpis
  for select using (
    user_id = public.auth_user_app_id()
    or public.auth_user_role() = 'Super-Admin'
    or (public.auth_user_role() = 'Admin' and public.same_sub_account_as_caller(user_id::text))
    or (public.auth_user_role() = 'Manager' and public.is_in_caller_downline(user_id))
  );

create policy "kpis_insert" on public.kpis
  for insert with check (
    public.auth_user_role() = 'Super-Admin'
    or (public.auth_user_role() = 'Admin' and public.same_sub_account_as_caller(user_id::text))
    or (public.auth_user_role() = 'Manager' and public.is_in_caller_downline(user_id))
  );

create policy "kpis_update" on public.kpis
  for update using (
    public.auth_user_role() = 'Super-Admin'
    or (public.auth_user_role() = 'Admin' and public.same_sub_account_as_caller(user_id::text))
    or (public.auth_user_role() = 'Manager' and public.is_in_caller_downline(user_id))
  );

create policy "kpis_delete" on public.kpis
  for delete using (
    public.auth_user_role() = 'Super-Admin'
    or (public.auth_user_role() = 'Admin' and public.same_sub_account_as_caller(user_id::text))
    or (public.auth_user_role() = 'Manager' and public.is_in_caller_downline(user_id))
  );

-- ── kpi_daily_logs ────────────────────────────────────────────────────────────

drop policy if exists "kpi_daily_logs_select" on public.kpi_daily_logs;

create policy "kpi_daily_logs_select" on public.kpi_daily_logs
  for select using (
    user_id = public.auth_user_app_id()
    or public.auth_user_role() = 'Super-Admin'
    or (public.auth_user_role() = 'Admin' and public.same_sub_account_as_caller(user_id::text))
    or (public.auth_user_role() = 'Manager' and public.is_in_caller_downline(user_id))
  );

-- ── subscriptions ─────────────────────────────────────────────────────────────
-- Admin write was role-gated only — no check that the row was their own sub-account.

drop policy if exists "subscriptions_write_admin" on public.subscriptions;

create policy "subscriptions_write_admin" on public.subscriptions
  for all using (
    public.auth_user_role() = 'Super-Admin'
    or (public.auth_user_role() = 'Admin' and sub_account = public.auth_user_sub_account())
  )
  with check (
    public.auth_user_role() = 'Super-Admin'
    or (public.auth_user_role() = 'Admin' and sub_account = public.auth_user_sub_account())
  );

-- ── public_holidays ───────────────────────────────────────────────────────────
-- Same gap: Admin write was role-gated only.

drop policy if exists "holidays_write_admin" on public.public_holidays;

create policy "holidays_write_admin" on public.public_holidays
  for all using (
    public.auth_user_role() = 'Super-Admin'
    or (public.auth_user_role() = 'Admin' and sub_account = public.auth_user_sub_account())
  );

-- ── payment_transactions ──────────────────────────────────────────────────────
-- Functional correctness fix: used raw auth.uid() instead of the email-based
-- lookup, so it silently returned zero rows for any Admin whose users.id
-- doesn't match their auth uid (the same class of mismatch fixed elsewhere).

drop policy if exists "payment_transactions_select" on public.payment_transactions;

create policy "payment_transactions_select" on public.payment_transactions
  for select using (
    public.auth_user_role() = 'Super-Admin'
    or (public.auth_user_role() = 'Admin' and sub_account = public.auth_user_sub_account())
  );
