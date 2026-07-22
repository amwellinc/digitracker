-- Migration 031: Close a cross-tenant task-visibility leak.
--
-- Reported: a task created in sub-account AM333 was visible to a user in a
-- different sub-account (AMWELL USA). Root-caused to two gaps, both in
-- tasks RLS (task_comments_select already got this right — see 027):
--
-- 1. tasks_insert / tasks_update never validated assignee_id's sub-account —
--    only creator_id was checked. The app's own assignee picker has always
--    been sub-account-scoped, so this couldn't happen through normal UI use
--    today, but nothing at the database level actually enforced it, so a
--    direct write (a bug, a script, manual testing) could set — and, going
--    by the report, apparently did set — a cross-tenant assignee_id that
--    RLS then happily honored forever after.
--
-- 2. tasks_select only ever checked the legacy single assignee_id column for
--    "is this person a participant" — never the task_assignees table (multi-
--    assignee). A person added only via task_assignees, or their manager,
--    could fail to see a task that's rightfully theirs. Doesn't explain the
--    leak, but it's exactly what "restricted and displayed to ... User,
--    Assignee ..." requires, so it's fixed in the same pass.
--
-- Visibility is now: task creator, every assignee (legacy column AND
-- task_assignees), any assignee's manager (via downline), any Admin in the
-- same sub-account as the creator or any assignee, and Super-Admin.

-- ── Reusable participant/oversight checks ─────────────────────────────────────

create or replace function public.is_task_participant(p_task_id uuid)
  returns boolean
  language sql security definer stable
as $$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task_id
      and (
        t.creator_id = public.auth_user_app_id()
        or t.assignee_id = public.auth_user_app_id()
        or exists (
          select 1 from public.task_assignees ta
          where ta.task_id = t.id and ta.user_id = public.auth_user_app_id()
        )
      )
  )
$$;

create or replace function public.admin_can_see_task(p_task_id uuid)
  returns boolean
  language sql security definer stable
as $$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task_id
      and (
        public.same_sub_account_as_caller(t.creator_id::text)
        or public.same_sub_account_as_caller(t.assignee_id::text)
        or exists (
          select 1 from public.task_assignees ta
          where ta.task_id = t.id and public.same_sub_account_as_caller(ta.user_id::text)
        )
      )
  )
$$;

create or replace function public.manager_can_see_task(p_task_id uuid)
  returns boolean
  language sql security definer stable
as $$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task_id
      and (
        public.is_in_caller_downline(t.creator_id)
        or public.is_in_caller_downline(t.assignee_id)
        or exists (
          select 1 from public.task_assignees ta
          where ta.task_id = t.id and public.is_in_caller_downline(ta.user_id)
        )
      )
  )
$$;

-- ── tasks ────────────────────────────────────────────────────────────────────

drop policy if exists "tasks_select" on public.tasks;
drop policy if exists "tasks_insert" on public.tasks;
drop policy if exists "tasks_update" on public.tasks;

create policy "tasks_select" on public.tasks
  for select using (
    public.is_task_participant(id)
    or public.auth_user_role() = 'Super-Admin'
    or (public.auth_user_role() = 'Admin' and public.admin_can_see_task(id))
    or (public.auth_user_role() = 'Manager' and public.manager_can_see_task(id))
  );

-- WITH CHECK now validates assignee_id explicitly — this is the fix for the
-- actual leak: a cross-tenant assignee_id can no longer be written, on
-- create or on edit, regardless of role or how the write happens.
create policy "tasks_insert" on public.tasks
  for insert with check (
    (
      creator_id = public.auth_user_app_id()
      or public.auth_user_role() = 'Super-Admin'
      or (public.auth_user_role() = 'Admin' and public.same_sub_account_as_caller(creator_id::text))
      or (public.auth_user_role() = 'Manager' and public.is_in_caller_downline(creator_id))
    )
    and (
      assignee_id is null
      or public.auth_user_role() = 'Super-Admin'
      or public.same_sub_account_as_caller(assignee_id::text)
    )
  );

create policy "tasks_update" on public.tasks
  for update using (
    public.is_task_participant(id)
    or public.auth_user_role() = 'Super-Admin'
    or (public.auth_user_role() = 'Admin' and public.admin_can_see_task(id))
    or (public.auth_user_role() = 'Manager' and public.manager_can_see_task(id))
  )
  with check (
    assignee_id is null
    or public.auth_user_role() = 'Super-Admin'
    or public.same_sub_account_as_caller(assignee_id::text)
  );

-- ── task_assignees — also require the task itself to be in the caller's scope ──

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
      and public.admin_can_see_task(task_id)
    )
    or (
      public.auth_user_role() = 'Manager'
      and public.is_in_caller_downline(user_id)
      and public.target_user_is_active(user_id)
      and public.manager_can_see_task(task_id)
    )
  );

-- ── Data remediation ───────────────────────────────────────────────────────────
-- Clear any existing cross-tenant assignment already sitting in the table —
-- this is what actually stops the reported leak from continuing to show.
-- Nothing else about the task (title, description, creator, status) changes.

update public.tasks t
set assignee_id = null
where t.assignee_id is not null
  and exists (
    select 1 from public.users creator, public.users assignee
    where creator.id = t.creator_id
      and assignee.id = t.assignee_id
      and creator.sub_account is distinct from assignee.sub_account
  );

delete from public.task_assignees ta
using public.tasks t, public.users creator, public.users assignee
where ta.task_id = t.id
  and t.creator_id = creator.id
  and ta.user_id = assignee.id
  and creator.sub_account is distinct from assignee.sub_account;
