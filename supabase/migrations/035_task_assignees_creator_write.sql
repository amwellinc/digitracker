-- Migration 035: Fix "Staff cannot create a Task" — task_assignees_write had
-- no clause at all for a Staff/Manager-without-downline user, or a Manager
-- writing for their OWN task. Reported as: a Staff user (Simila) creates a
-- task and assigns it (even to herself) — the app's own CreateTaskModal
-- never checks the task_assignees insert for an error, so this failed
-- silently: the tasks row saved, but the task_assignees row that actually
-- drives "who is assigned" in the UI never did.
--
-- Root cause: task_assignees_write only ever granted Admin (same sub-account)
-- and Manager (own downline) and Super-Admin — there was no branch at all for
-- "I am the task's creator" or "I am assigning myself." tasks_insert /
-- tasks_update already allow any role to create/edit a task they own; this
-- migration makes task_assignees_write consistent with that.
--
-- Also fixes a related, symmetrical read gap: task_assignees_select had no
-- "I created this task" clause either, so a non-Admin/Manager creator who
-- assigned a task to a teammate (not themselves) couldn't see that
-- teammate's task_assignees row — the reusable is_task_participant() helper
-- from migration 031 already covers "creator OR assignee OR in
-- task_assignees", so it's reused here.

drop policy if exists "task_assignees_select" on public.task_assignees;
drop policy if exists "task_assignees_write"  on public.task_assignees;

create policy "task_assignees_select" on public.task_assignees
  for select using (
    user_id = public.auth_user_app_id()
    or public.is_task_participant(task_id)
    or public.auth_user_role() = 'Super-Admin'
    or (public.auth_user_role() = 'Admin' and public.same_sub_account_as_caller(user_id::text))
    or (public.auth_user_role() = 'Manager' and public.is_in_caller_downline(user_id))
  );

create policy "task_assignees_write" on public.task_assignees
  for all using (
    user_id = public.auth_user_app_id()
    or exists (
      select 1 from public.tasks t
      where t.id = task_assignees.task_id
        and t.creator_id = public.auth_user_app_id()
    )
    or public.auth_user_role() = 'Super-Admin'
    or (public.auth_user_role() = 'Admin' and public.same_sub_account_as_caller(user_id::text))
    or (public.auth_user_role() = 'Manager' and public.is_in_caller_downline(user_id))
  )
  with check (
    user_id = public.auth_user_app_id()
    or (
      exists (
        select 1 from public.tasks t
        where t.id = task_assignees.task_id
          and t.creator_id = public.auth_user_app_id()
      )
      and public.same_sub_account_as_caller(user_id::text)
      and public.target_user_is_active(user_id)
    )
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
