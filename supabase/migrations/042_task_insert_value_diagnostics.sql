-- Migration 042: Value-level diagnostic for tasks_insert.
--
-- The self-check from 041 came back clean for corporate@am333international.com
-- — auth_user_role, auth_user_app_id, sub_account, and both
-- same_sub_account_as_self checks all resolve correctly and consistently.
-- That rules out the caller's OWN identity as the problem. tasks_insert's
-- WITH CHECK has a second clause the self-check never exercised: whatever
-- assignee_id is actually being submitted. This function mirrors the exact
-- current tasks_insert logic against the REAL creator_id/assignee_id values
-- from a failed request, so the next failure pinpoints which clause — and
-- which specific id — is actually rejected, instead of another self-check
-- that (as just proven) can pass while the real insert still fails.

create or replace function public.debug_task_insert_values(
  p_creator_id  uuid,
  p_assignee_id uuid default null
)
  returns jsonb
  language sql security definer stable
as $$
  select jsonb_build_object(
    'caller_email',        auth.email(),
    'caller_role',         public.auth_user_role(),
    'caller_sub_account',  public.auth_user_sub_account(),
    'p_creator_id',        p_creator_id,
    'creator_sub_account', (select sub_account from public.users where id = p_creator_id),
    'creator_clause_passes', (
      public.auth_user_role() = 'Super-Admin'
      or public.same_sub_account_as_caller(p_creator_id::text)
    ),
    'p_assignee_id',        p_assignee_id,
    'assignee_sub_account', (select sub_account from public.users where id = p_assignee_id),
    'assignee_clause_passes', (
      p_assignee_id is null
      or public.auth_user_role() = 'Super-Admin'
      or public.same_sub_account_as_caller(p_assignee_id::text)
    )
  )
$$;

grant execute on function public.debug_task_insert_values(uuid, uuid) to authenticated;
