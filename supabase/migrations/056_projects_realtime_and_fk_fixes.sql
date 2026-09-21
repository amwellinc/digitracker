-- Migration 056: Projects feature fix wave — realtime publication, FK
-- cascade semantics, and presence de-duplication.
--
-- 055_projects_feature.sql is left untouched (it may already be applied to
-- a database). This migration is purely additive/corrective on top of it.

-- ── Fix 1: add the new tables to the realtime publication ──────────────────
-- Mirrors the exact convention used for tasks/task_comments/task_assignees
-- in 005_tasks_full_feature.sql lines 138-140. Without this,
-- ProjectTaskDetailModal.tsx's comment-posting flow (a faithful copy of
-- TaskDetailModal.tsx) has no realtime INSERT event to react to and no
-- fallback refetch, so a posted comment silently fails to appear until the
-- modal is closed and reopened.

DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.project_tasks; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.project_task_assignees; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.project_task_comments; EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- ── Fix 2: add missing ON DELETE clauses to 5 new foreign keys ──────────────
-- 055 declared these 5 FKs to public.users(id) with no ON DELETE clause
-- (default NO ACTION), unlike every existing FK to users(id) in this
-- schema (see 001_initial_schema.sql lines 15, 26, 36, 46-47, 56-57, 65).
-- creator_id / plain user_id columns follow the existing convention of
-- ON DELETE CASCADE; the optional assignee_id column follows the existing
-- convention of ON DELETE SET NULL. Without this, the already-shipped
-- archive_and_delete_user RPC (027_suspend_archive_and_scoping.sql) raises
-- a raw FK-violation error and aborts whenever a Super-Admin deletes a
-- suspended user who has ever created a project, created/been-assigned a
-- project task, or commented on one.
--
-- None of the 5 FKs below were given an explicit constraint name in 055,
-- so Postgres's default <table>_<column>_fkey naming applies to all of
-- them — confirmed by reading 055_projects_feature.sql directly.

ALTER TABLE public.projects
  DROP CONSTRAINT projects_created_by_fkey,
  ADD CONSTRAINT projects_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE public.project_tasks
  DROP CONSTRAINT project_tasks_creator_id_fkey,
  ADD CONSTRAINT project_tasks_creator_id_fkey
    FOREIGN KEY (creator_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE public.project_tasks
  DROP CONSTRAINT project_tasks_assignee_id_fkey,
  ADD CONSTRAINT project_tasks_assignee_id_fkey
    FOREIGN KEY (assignee_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.project_task_assignees
  DROP CONSTRAINT project_task_assignees_user_id_fkey,
  ADD CONSTRAINT project_task_assignees_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE public.project_task_comments
  DROP CONSTRAINT project_task_comments_user_id_fkey,
  ADD CONSTRAINT project_task_comments_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

-- ── Fix 3: fix ghost/duplicate presence rows in get_project_member_status ──
-- The original definition plain-LEFT-JOINed on tl.status IN ('working',
-- 'lunch') with no recency bound and no de-duplication. Two bugs result:
-- (a) a member whose session was left active on a prior day and never
-- cleaned up shows as permanently "idle" instead of "offline"; (b) if that
-- same user also has a genuine active session today, the join returns two
-- rows for them, causing duplicate React keys and duplicate entries in the
-- presence header and both task modals' assignee pickers.
--
-- Fixed by bounding to sessions started within the last 24 hours (older is
-- presumed abandoned and reads as offline — a display-layer safety net
-- mirroring the app-wide convention that abandoned sessions get cleaned
-- up) and by using DISTINCT ON (u.id) ... ORDER BY tl.clock_in DESC NULLS
-- LAST to guarantee at most one row per member.

create or replace function public.get_project_member_status(p_project_id uuid)
  returns table (
    user_id          uuid,
    name             text,
    profile_image    text,
    status           text,
    last_activity_at timestamptz
  )
  language sql security definer stable
as $$
  select distinct on (u.id)
    u.id, u.name, u.profile_image, tl.status, tl.last_activity_at
  from public.project_members pm
  join public.users u on u.id = pm.user_id
  left join public.time_logs tl
    on tl.user_id = u.id
    and tl.status in ('working', 'lunch')
    and tl.clock_in > now() - interval '24 hours'
  where pm.project_id = p_project_id
    and public.is_project_member(p_project_id)
  order by u.id, tl.clock_in desc nulls last
$$;

grant execute on function public.get_project_member_status(uuid) to authenticated;

-- ── Schema cache reload ──────────────────────────────────────────────────
-- Covers this entire migration, including the FK/constraint changes above.

notify pgrst, 'reload schema';
