-- Migration 046: Clean rebuild of the Tasks module's data-access rules.
--
-- After repeated patches (026, 031, 035, 036, 040) the tasks/task_assignees/
-- task_comments/notifications policies had drifted into several different,
-- inconsistent visibility rules — e.g. notifications_select_own and the old
-- task_comments_select let any Admin see ANY task-related row in their
-- sub-account regardless of whether they had anything to do with that task,
-- while tasks_select itself was already scoped to participants. That's the
-- kind of layered inconsistency this rebuild replaces with one rule, stated
-- once and reused everywhere:
--
--   CREATE:  anyone can create a task for themselves. A Manager can also
--            assign it to anyone in their own downline (including
--            themselves). An Admin can also assign it to anyone in their
--            own sub-account. Super-Admin can do anything.
--   ACCESS:  (select tasks, read/post comments, receive notifications)
--            ONLY the task's creator and its assignee(s) — nobody else,
--            regardless of role, sees or is notified about a task they
--            aren't part of. Super-Admin remains the one platform-wide
--            exception (consistent with every other table in this schema).
--
-- No cross-tenant path exists anywhere in this — every assignee check goes
-- through same_sub_account_as_caller / is_in_caller_downline, both of which
-- already refuse to cross a sub-account boundary.

-- ── tasks ────────────────────────────────────────────────────────────────────

drop policy if exists "tasks_select" on public.tasks;
drop policy if exists "tasks_insert" on public.tasks;
drop policy if exists "tasks_update" on public.tasks;

create policy "tasks_select" on public.tasks
  for select using (
    public.auth_user_role() = 'Super-Admin'
    or public.is_task_participant(id)
  );

create policy "tasks_insert" on public.tasks
  for insert with check (
    creator_id = public.auth_user_app_id()
    and (
      assignee_id is null
      or assignee_id = public.auth_user_app_id()
      or public.auth_user_role() = 'Super-Admin'
      or (public.auth_user_role() = 'Manager' and public.is_in_caller_downline(assignee_id))
      or (public.auth_user_role() = 'Admin' and public.same_sub_account_as_caller(assignee_id::text))
    )
  );

create policy "tasks_update" on public.tasks
  for update using (
    public.auth_user_role() = 'Super-Admin'
    or public.is_task_participant(id)
  )
  with check (
    assignee_id is null
    or assignee_id = public.auth_user_app_id()
    or public.auth_user_role() = 'Super-Admin'
    or (public.auth_user_role() = 'Manager' and public.is_in_caller_downline(assignee_id))
    or (public.auth_user_role() = 'Admin' and public.same_sub_account_as_caller(assignee_id::text))
  );

-- tasks_delete is untouched — creator, Admin (same sub-account), Manager
-- (downline), or Super-Admin, exactly as migration 026 left it.

-- ── task_assignees ───────────────────────────────────────────────────────────

drop policy if exists "task_assignees_select" on public.task_assignees;
drop policy if exists "task_assignees_write" on public.task_assignees;

create policy "task_assignees_select" on public.task_assignees
  for select using (
    public.auth_user_role() = 'Super-Admin'
    or user_id = public.auth_user_app_id()
    or public.is_task_participant(task_id)
  );

create policy "task_assignees_write" on public.task_assignees
  for all using (
    public.auth_user_role() = 'Super-Admin'
    or user_id = public.auth_user_app_id()
    or exists (
      select 1 from public.tasks t
      where t.id = task_assignees.task_id and t.creator_id = public.auth_user_app_id()
    )
  )
  with check (
    public.auth_user_role() = 'Super-Admin'
    or user_id = public.auth_user_app_id()
    or (
      exists (
        select 1 from public.tasks t
        where t.id = task_assignees.task_id and t.creator_id = public.auth_user_app_id()
      )
      and (
        (public.auth_user_role() = 'Manager' and public.is_in_caller_downline(user_id))
        or (public.auth_user_role() = 'Admin' and public.same_sub_account_as_caller(user_id::text))
      )
    )
  );

-- ── task_comments — "replied": only participants read or post ──────────────

drop policy if exists "task_comments_select" on public.task_comments;
drop policy if exists "task_comments_insert" on public.task_comments;

create policy "task_comments_select" on public.task_comments
  for select using (
    public.auth_user_role() = 'Super-Admin'
    or public.is_task_participant(task_id)
  );

create policy "task_comments_insert" on public.task_comments
  for insert with check (
    user_id = public.auth_user_app_id()
    and (
      public.auth_user_role() = 'Super-Admin'
      or public.is_task_participant(task_id)
    )
  );

-- ── notifications — task-type notifications are participant-only ───────────
-- notifications_select_own's Admin/Manager sub-account-wide bypass stays for
-- every OTHER notification type (leave, holidays, new signups, etc. — that
-- oversight is intentional and unrelated to this rebuild) but is switched
-- off specifically for task_* types, so a task notification is only ever
-- visible to the exact person it was addressed to.

drop policy if exists "notifications_select_own" on public.notifications;

create policy "notifications_select_own" on public.notifications
  for select using (
    user_id = public.auth_user_app_id()
    or public.auth_user_role() = 'Super-Admin'
    or (
      type not in ('task_assigned', 'task_reply', 'task_completed', 'task_closed')
      and (
        (public.auth_user_role() = 'Admin' and public.same_sub_account_as_caller(user_id::text))
        or (public.auth_user_role() = 'Manager' and public.is_in_caller_downline(user_id))
      )
    )
  );

-- Every RLS change above must be visible to PostgREST immediately — the
-- last several "still broken" reports on this exact table all traced back
-- to PostgREST serving a stale cached plan after a policy change instead of
-- picking up the new definition (same root cause as the leave_requests
-- schema-cache incident). Never skip this on a tasks/task_assignees/
-- task_comments/notifications policy change again.
notify pgrst, 'reload schema';
