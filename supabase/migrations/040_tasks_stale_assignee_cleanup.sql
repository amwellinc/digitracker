-- Migration 040: Clean up stale cross-tenant task assignments.
--
-- Reported: an Admin (corporate@am333international.com) tried to update a
-- task — just a status/field change, not touching who it's assigned to —
-- and got "new row violates row-level security policy for table tasks".
--
-- Root cause: tasks_update's WITH CHECK re-validates assignee_id's
-- sub-account against the creator's on EVERY write, not only when
-- assignee_id itself changes (Postgres RLS re-checks the whole new row
-- regardless of which columns the UPDATE statement actually touched). If a
-- task's stored assignee_id is a leftover cross-tenant value — from before
-- migration 031's fix, or from one that slipped past that migration's
-- remediation sweep — even an unrelated field edit now fails, because the
-- unchanged-but-still-invalid assignee_id gets re-checked and rejected.
-- Foreign keys guarantee assignee_id/creator_id reference real users (no
-- dangling refs possible), so "invalid" here only ever means genuinely
-- cross-tenant, exactly what 031 targeted — this is the same class of bad
-- data, either missed then or introduced since.
--
-- Fix is data cleanup, not a policy change — the WITH CHECK behavior itself
-- is correct (it's what stops new cross-tenant assignments from being
-- written at all). Re-running the same style of sweep 031 did closes out
-- any straggler rows so legitimate edits on old tasks stop being blocked.

update public.tasks t
   set assignee_id = null
 where t.assignee_id is not null
   and not exists (
     select 1
       from public.users creator
       join public.users assignee on assignee.id = t.assignee_id
      where creator.id = t.creator_id
        and assignee.sub_account = creator.sub_account
   );

delete from public.task_assignees ta
using public.tasks t
where ta.task_id = t.id
  and not exists (
    select 1
      from public.users creator
      join public.users assignee on assignee.id = ta.user_id
     where creator.id = t.creator_id
       and assignee.sub_account = creator.sub_account
  );
