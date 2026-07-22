-- Migration 027: User suspension + archive-on-delete, task comment visibility,
-- and Admin/Manager leave requests on behalf of an assigned user.
--
-- 1. Suspension: a new users.status column. auth_user_app_id/role/sub_account
--    are redefined to require status = 'active', so a suspended user's own
--    identity resolves to NULL everywhere — every RLS policy in the schema
--    that depends on those three functions (which is all of them) locks them
--    out automatically, with no per-table changes needed. Admin/Manager keep
--    full read access to a suspended user's existing data (nothing here
--    changes SELECT policies), but new write-on-behalf actions (uploading a
--    document, filing/approving leave, assigning a task, setting a KPI
--    template) now additionally require the target to still be active.
--
-- 2. Deletion is now only possible for an already-suspended user (Admin),
--    and only through archive_and_delete_user(), which the client calls
--    after uploading a generated archive file to storage. Snapshot fields are
--    denormalized (name/email/role as text, not a users FK) specifically so
--    the archive record survives the user row being deleted.
--
-- 3. task_comments_select is rewritten from "see only comments you wrote" to
--    "see all comments on a task you actually participate in" (creator,
--    assignee, or task_assignees member), still with the same Admin/Manager/
--    Super-Admin oversight scoping used everywhere else.

-- ── users.status ──────────────────────────────────────────────────────────────

alter table public.users
  add column if not exists status text not null default 'active'
    check (status in ('active', 'suspended'));

-- ── Core identity helpers now require an active account ───────────────────────

create or replace function public.auth_user_app_id()
  returns uuid
  language sql security definer stable
as $$
  select id from public.users where lower(email) = lower(auth.email()) and status = 'active'
$$;

create or replace function public.auth_user_role()
  returns text
  language sql security definer stable
as $$
  select role from public.users where lower(email) = lower(auth.email()) and status = 'active'
$$;

create or replace function public.auth_user_sub_account()
  returns text
  language sql security definer stable
as $$
  select sub_account from public.users where lower(email) = lower(auth.email()) and status = 'active'
$$;

-- Whether a given user (the target of an on-behalf write) is still active.
create or replace function public.target_user_is_active(p_target_user_id uuid)
  returns boolean
  language sql security definer stable
as $$
  select coalesce((select status = 'active' from public.users where id = p_target_user_id), false)
$$;

-- Lets the login flow tell "suspended" apart from "no such account" even
-- though a suspended caller's own auth_user_* lookups now return NULL and
-- their users_select_same_sub_account RLS check can no longer see their own
-- row. Deliberately bypasses RLS (SECURITY DEFINER) — it only ever returns a
-- single status string, never any other column.
create or replace function public.check_account_status(p_email text)
  returns text
  language sql security definer stable
as $$
  select status from public.users where lower(email) = lower(p_email) limit 1
$$;

grant execute on function public.check_account_status(text) to authenticated;

-- ── users delete — Admin can only delete an already-suspended account ────────

drop policy if exists "users_delete_admin" on public.users;

create policy "users_delete_admin" on public.users
  for delete using (
    public.auth_user_role() = 'Super-Admin'
    or (
      public.auth_user_role() = 'Admin'
      and sub_account = public.auth_user_sub_account()
      and status = 'suspended'
    )
  );

-- ── documents — Admin upload on behalf requires an active target ─────────────

drop policy if exists "documents_insert" on public.documents;

create policy "documents_insert" on public.documents
  for insert with check (
    user_id = public.auth_user_app_id()
    or public.auth_user_role() = 'Super-Admin'
    or (
      public.auth_user_role() = 'Admin'
      and public.same_sub_account_as_caller(user_id::text)
      and public.target_user_is_active(user_id)
    )
  );

-- ── leave_requests — Admin/Manager can file AND update on behalf ─────────────

drop policy if exists "leave_insert_own" on public.leave_requests;
drop policy if exists "leaves_update"    on public.leave_requests;

create policy "leave_insert_own" on public.leave_requests
  for insert with check (
    user_id = public.auth_user_app_id()
    or public.auth_user_role() = 'Super-Admin'
    or (
      public.auth_user_role() = 'Admin'
      and public.same_sub_account_as_caller(user_id::text)
      and public.target_user_is_active(user_id)
    )
    or (
      public.auth_user_role() = 'Manager'
      and public.is_in_caller_downline(user_id)
      and public.target_user_is_active(user_id)
    )
  );

create policy "leaves_update" on public.leave_requests
  for update using (
    user_id = public.auth_user_app_id()
    or public.auth_user_role() = 'Super-Admin'
    or (
      public.auth_user_role() = 'Admin'
      and public.same_sub_account_as_caller(user_id::text)
      and public.target_user_is_active(user_id)
    )
    or (
      public.auth_user_role() = 'Manager'
      and public.is_in_caller_downline(user_id)
      and public.target_user_is_active(user_id)
    )
  );

-- ── task_assignees — assigning someone new requires an active target ─────────

drop policy if exists "task_assignees_write" on public.task_assignees;

create policy "task_assignees_write" on public.task_assignees
  for all using (
    public.auth_user_role() = 'Super-Admin'
    or (public.auth_user_role() = 'Admin' and public.same_sub_account_as_caller(user_id::text))
    or (public.auth_user_role() = 'Manager' and public.is_in_caller_downline(user_id))
  )
  with check (
    public.auth_user_role() = 'Super-Admin'
    or (
      public.auth_user_role() = 'Admin'
      and public.same_sub_account_as_caller(user_id::text)
      and public.target_user_is_active(user_id)
    )
    or (
      public.auth_user_role() = 'Manager'
      and public.is_in_caller_downline(user_id)
      and public.target_user_is_active(user_id)
    )
  );

-- ── kpis — setting/editing a template on behalf requires an active target ────

drop policy if exists "kpis_insert" on public.kpis;
drop policy if exists "kpis_update" on public.kpis;

create policy "kpis_insert" on public.kpis
  for insert with check (
    public.auth_user_role() = 'Super-Admin'
    or (
      public.auth_user_role() = 'Admin'
      and public.same_sub_account_as_caller(user_id::text)
      and public.target_user_is_active(user_id)
    )
    or (
      public.auth_user_role() = 'Manager'
      and public.is_in_caller_downline(user_id)
      and public.target_user_is_active(user_id)
    )
  );

create policy "kpis_update" on public.kpis
  for update using (
    public.auth_user_role() = 'Super-Admin'
    or (public.auth_user_role() = 'Admin' and public.same_sub_account_as_caller(user_id::text))
    or (public.auth_user_role() = 'Manager' and public.is_in_caller_downline(user_id))
  )
  with check (
    public.auth_user_role() = 'Super-Admin'
    or (
      public.auth_user_role() = 'Admin'
      and public.same_sub_account_as_caller(user_id::text)
      and public.target_user_is_active(user_id)
    )
    or (
      public.auth_user_role() = 'Manager'
      and public.is_in_caller_downline(user_id)
      and public.target_user_is_active(user_id)
    )
  );

-- ── task_comments — see every comment on a task you actually participate in ──

drop policy if exists "task_comments_select" on public.task_comments;

create policy "task_comments_select" on public.task_comments
  for select using (
    public.auth_user_role() = 'Super-Admin'
    or exists (
      select 1 from public.tasks t
      where t.id = task_comments.task_id
        and (
          t.creator_id = public.auth_user_app_id()
          or t.assignee_id = public.auth_user_app_id()
          or exists (
            select 1 from public.task_assignees ta
            where ta.task_id = t.id and ta.user_id = public.auth_user_app_id()
          )
          or (
            public.auth_user_role() = 'Admin'
            and (public.same_sub_account_as_caller(t.creator_id::text) or public.same_sub_account_as_caller(t.assignee_id::text))
          )
          or (
            public.auth_user_role() = 'Manager'
            and (public.is_in_caller_downline(t.creator_id) or public.is_in_caller_downline(t.assignee_id))
          )
        )
    )
  );

-- ── archived_employee_files ───────────────────────────────────────────────────
-- No user_id FK on purpose: the whole point is that this record outlives the
-- deleted users row. sub_account is a plain text snapshot too, in case the
-- sub_account itself is ever removed later.

create table if not exists public.archived_employee_files (
  id                 uuid primary key default gen_random_uuid(),
  sub_account        text not null,
  original_user_id   uuid,
  original_name      text not null,
  original_email     text not null,
  original_role      text not null,
  title              text not null,
  url                text not null,
  size               numeric not null,
  archived_by_name   text not null,
  archived_by_email  text not null,
  archived_at        timestamptz not null default now()
);

create index if not exists archived_employee_files_sub_account_idx
  on public.archived_employee_files (sub_account, archived_at desc);

alter table public.archived_employee_files enable row level security;

create policy "archived_employee_files_select" on public.archived_employee_files
  for select using (
    public.auth_user_role() = 'Super-Admin'
    or (public.auth_user_role() = 'Admin' and sub_account = public.auth_user_sub_account())
  );

-- No insert/update/delete policy: rows are only ever written by
-- archive_and_delete_user() below, which runs as SECURITY DEFINER and
-- performs its own authorization checks rather than relying on RLS.

-- ── storage.objects — documents bucket, admin-only "_archive/<sub_account>/" prefix ──

drop policy if exists "archive_files_write" on storage.objects;
drop policy if exists "archive_files_read"  on storage.objects;

create policy "archive_files_write" on storage.objects
  for insert with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = '_archive'
    and (
      public.auth_user_role() = 'Super-Admin'
      or (public.auth_user_role() = 'Admin' and (storage.foldername(name))[2] = public.auth_user_sub_account())
    )
  );

create policy "archive_files_read" on storage.objects
  for select using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = '_archive'
    and (
      public.auth_user_role() = 'Super-Admin'
      or (public.auth_user_role() = 'Admin' and (storage.foldername(name))[2] = public.auth_user_sub_account())
    )
  );

-- ── Archive snapshot + purge ───────────────────────────────────────────────────

-- Gathers a human-readable snapshot of everything tied to p_user_id. Does NOT
-- delete or write anything — the caller renders this into a file and uploads
-- it to storage before calling archive_and_delete_user().
create or replace function public.build_user_archive_snapshot(p_user_id uuid)
  returns jsonb
  language plpgsql security definer stable
  set search_path = public
as $$
declare
  v_caller_role text;
  v_caller_sub  text;
  v_target      public.users%rowtype;
  v_snapshot    jsonb;
begin
  select role, sub_account into v_caller_role, v_caller_sub
    from public.users where lower(email) = lower(auth.email()) and status = 'active';

  select * into v_target from public.users where id = p_user_id;
  if not found then
    raise exception 'User not found';
  end if;

  if v_caller_role is distinct from 'Super-Admin' then
    if v_caller_role is distinct from 'Admin' or v_caller_sub is distinct from v_target.sub_account then
      raise exception 'Only an Admin of this workspace can archive this user';
    end if;
  end if;

  if v_target.status is distinct from 'suspended' then
    raise exception 'Only a suspended account can be archived';
  end if;

  select jsonb_build_object(
    'profile', jsonb_build_object(
      'name', v_target.name, 'email', v_target.email, 'role', v_target.role,
      'sub_account', v_target.sub_account, 'country', v_target.country, 'phone', v_target.phone,
      'annual_leave', v_target.annual_leave, 'time_off', v_target.time_off,
      'reporting_time_in', v_target.reporting_time_in, 'reporting_time_out', v_target.reporting_time_out,
      'member_since', v_target.created_at
    ),
    'time_logs', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'date', date, 'status', status, 'clock_in', clock_in, 'clock_out', clock_out, 'total_minutes', total_minutes
      ) order by date), '[]'::jsonb)
      from public.time_logs where user_id = p_user_id
    ),
    'leave_requests', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'type', type, 'start_date', start_date, 'end_date', end_date, 'hours', hours,
        'status', status, 'reason', reason, 'remarks', remarks
      ) order by created_at), '[]'::jsonb)
      from public.leave_requests where user_id = p_user_id
    ),
    'tasks_created', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'title', title, 'status', status, 'due_date', due_date, 'created_at', created_at
      ) order by created_at), '[]'::jsonb)
      from public.tasks where creator_id = p_user_id
    ),
    'tasks_assigned', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'title', t.title, 'status', t.status, 'due_date', t.due_date
      ) order by t.created_at), '[]'::jsonb)
      from public.tasks t
      where t.assignee_id = p_user_id
         or exists (select 1 from public.task_assignees ta where ta.task_id = t.id and ta.user_id = p_user_id)
    ),
    'kpi_daily_logs', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'date', date, 'notes', notes, 'submitted_at', submitted_at
      ) order by date), '[]'::jsonb)
      from public.kpi_daily_logs where user_id = p_user_id
    ),
    'documents', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'title', title, 'type', type, 'size', size, 'created_at', created_at
      ) order by created_at), '[]'::jsonb)
      from public.documents where user_id = p_user_id
    ),
    'eod_reports', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'date', date, 'body', body
      ) order by date), '[]'::jsonb)
      from public.eod_reports where user_id = p_user_id
    )
  ) into v_snapshot;

  return v_snapshot;
end;
$$;

grant execute on function public.build_user_archive_snapshot(uuid) to authenticated;

-- Records the already-uploaded archive file, then permanently deletes the
-- user (every FK below is ON DELETE CASCADE, so this purges everything the
-- snapshot above just captured). The archive row has no FK back to the user,
-- so it survives.
create or replace function public.archive_and_delete_user(
  p_user_id      uuid,
  p_archive_url  text,
  p_archive_size numeric,
  p_archive_title text
) returns uuid
  language plpgsql security definer
  set search_path = public
as $$
declare
  v_caller_role  text;
  v_caller_sub   text;
  v_caller_name  text;
  v_caller_email text;
  v_target       public.users%rowtype;
  v_archive_id   uuid;
begin
  select role, sub_account, name, email into v_caller_role, v_caller_sub, v_caller_name, v_caller_email
    from public.users where lower(email) = lower(auth.email()) and status = 'active';

  select * into v_target from public.users where id = p_user_id;
  if not found then
    raise exception 'User not found';
  end if;

  if v_caller_role is distinct from 'Super-Admin' then
    if v_caller_role is distinct from 'Admin' or v_caller_sub is distinct from v_target.sub_account then
      raise exception 'Only an Admin of this workspace can delete this user';
    end if;
  end if;

  if v_target.status is distinct from 'suspended' then
    raise exception 'Only a suspended account can be deleted';
  end if;

  insert into public.archived_employee_files (
    sub_account, original_user_id, original_name, original_email, original_role,
    title, url, size, archived_by_name, archived_by_email
  ) values (
    v_target.sub_account, v_target.id, v_target.name, v_target.email, v_target.role,
    p_archive_title, p_archive_url, p_archive_size, v_caller_name, v_caller_email
  ) returning id into v_archive_id;

  delete from public.users where id = p_user_id;

  return v_archive_id;
end;
$$;

grant execute on function public.archive_and_delete_user(uuid, text, numeric, text) to authenticated;
