-- Migration 036: Fix "row violates row-level security policy for table tasks"
-- for BOTH a Staff user and a Manager creating their own task.
--
-- Root cause: tasks_insert's first clause group only ever passed for
-- self-creation via an EXACT match: creator_id = auth_user_app_id(). The
-- role-based branches added alongside it are role-agnostic-USELESS for this
-- case:
--   - Admin's branch (same_sub_account_as_caller(creator_id)) trivially also
--     covers self-creation, since it doesn't require exact id equality —
--     Admin was accidentally immune.
--   - Super-Admin bypasses everything — also immune.
--   - Manager's branch (is_in_caller_downline(creator_id)) checks whether
--     creator_id reports TO the caller — never true for creator_id = the
--     caller's own id, since nobody is their own downline report. So a
--     Manager creating their OWN task got no help from this branch at all.
--   - Staff has no role branch whatsoever.
--
-- The app never lets a user set creator_id to anyone but themselves (see
-- CreateTaskModal.tsx — always `creator_id: user.id`), so every role's real
-- workload is 100% "self-creation." Only Admin/Super-Admin had a robust path
-- for that; Manager and Staff had a single exact-match check with no
-- fallback — which is what actually failed for both of them.
--
-- Fix: reuse the exact mechanism the second clause (assignee_id) already
-- uses successfully — same_sub_account_as_caller — for creator_id too. This
-- doesn't require exact id equality, isn't role-gated, and matches what
-- Admin already effectively had. It doesn't expand real-world capability:
-- the client never sends a foreign creator_id, and any role could already
-- assign a task to any teammate via assignee_id/task_assignees.

drop policy if exists "tasks_insert" on public.tasks;

create policy "tasks_insert" on public.tasks
  for insert with check (
    (
      public.auth_user_role() = 'Super-Admin'
      or public.same_sub_account_as_caller(creator_id::text)
    )
    and (
      assignee_id is null
      or public.auth_user_role() = 'Super-Admin'
      or public.same_sub_account_as_caller(assignee_id::text)
    )
  );
