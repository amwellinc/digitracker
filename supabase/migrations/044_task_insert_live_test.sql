-- Migration 044: Test the REAL insert path, not a reproduction of it.
--
-- pg_policies confirms the live tasks_insert WITH CHECK is exactly what
-- migration 036 defines, and evaluating that exact expression against the
-- exact submitted values (via debug_task_insert_values, itself calling the
-- same functions the policy calls) returns true for both clauses — yet the
-- real INSERT from the app still gets rejected. If a byte-for-byte
-- reproduction of the check passes while the actual enforcement fails, the
-- reproduction must be missing something about how Postgres evaluates the
-- real statement. Rather than reproduce the check a third way, this
-- performs the ACTUAL insert — as the calling user, via SECURITY INVOKER,
-- so real RLS applies exactly as it does for the app's own request — and
-- immediately rolls it back via a forced exception, so nothing persists
-- either way. Whatever this reports IS what a real insert does, not a
-- theory about it.

create or replace function public.debug_try_task_insert(
  p_creator_id  uuid,
  p_assignee_id uuid
)
  returns jsonb
  language plpgsql
  security invoker
as $$
declare
  v_result jsonb;
begin
  begin
    insert into public.tasks (title, creator_id, assignee_id)
    values ('__DIAGNOSTIC_TEST_DO_NOT_KEEP__', p_creator_id, p_assignee_id);

    -- Reaching here means the insert was allowed. Force a rollback of just
    -- this attempt via the exception handler below — this test must never
    -- leave a row behind, whether the insert succeeded or not.
    raise exception using message = '__DIAGNOSTIC_ROLLBACK__';
  exception
    when others then
      if sqlerrm = '__DIAGNOSTIC_ROLLBACK__' then
        v_result := jsonb_build_object('insert_would_succeed', true);
      else
        v_result := jsonb_build_object(
          'insert_would_succeed', false,
          'sqlstate', sqlstate,
          'message', sqlerrm
        );
      end if;
  end;
  return v_result;
end;
$$;

grant execute on function public.debug_try_task_insert(uuid, uuid) to authenticated;
