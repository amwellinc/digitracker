-- Migration 041: Self-scoped diagnostic for "row violates row-level security
-- policy for table tasks" on create.
--
-- Three fixes (035, 036, 040) have gone at this class of error from
-- different angles — task_assignees write gap, tasks_insert self-creation
-- gap, stale cross-tenant assignee data — and it is still reported,
-- including now for an Admin creating their own task, which the current
-- policy should already allow. Re-reading every migration that touches the
-- relevant functions (same_sub_account_as_caller, auth_user_role,
-- auth_user_app_id, auth_user_sub_account) turns up nothing that changed
-- around the time the Departments feature shipped, or since.
--
-- Rather than guess a fourth fix blind, this function reveals exactly what
-- those functions resolve to for the CALLING user, from inside their own
-- real session — the only way to get ground truth on identity resolution
-- without live DB access. It is intentionally self-scoped only (a caller
-- can only ever see their own resolution, never anyone else's), so it's
-- safe to leave callable by any authenticated user.

create or replace function public.debug_my_task_insert_check()
  returns jsonb
  language sql security definer stable
as $$
  select jsonb_build_object(
    'auth_email',            auth.email(),
    'auth_user_app_id',      public.auth_user_app_id(),
    'auth_user_role',        public.auth_user_role(),
    'auth_user_sub_account', public.auth_user_sub_account(),
    'users_row_by_email', (
      select to_jsonb(u) - 'phone' - 'address_line1' - 'address_line2'
        from public.users u
       where lower(u.email) = lower(auth.email())
    ),
    'same_sub_account_as_self_by_app_id', (
      select public.same_sub_account_as_caller(public.auth_user_app_id()::text)
    ),
    'same_sub_account_as_self_by_row_id', (
      select public.same_sub_account_as_caller(u.id::text)
        from public.users u
       where lower(u.email) = lower(auth.email())
    )
  )
$$;

grant execute on function public.debug_my_task_insert_check() to authenticated;
