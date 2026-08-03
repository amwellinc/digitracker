-- Migration 047: Test the exact query shape PostgREST generates.
--
-- debug_try_task_insert (a bare `INSERT ... VALUES (...)`, no RETURNING)
-- succeeded with real RLS under the reporting Admin's real session. But
-- CreateTaskModal.tsx calls `.insert(payload).select().single()`, which
-- supabase-js turns into `Prefer: return=representation`, which PostgREST
-- implements as an INSERT wrapped in a CTE with a RETURNING clause, read by
-- an outer SELECT — a genuinely different query shape than what was tested.
-- This reproduces that exact shape to check whether it behaves differently.

create or replace function public.debug_try_task_insert_returning(
  p_creator_id  uuid,
  p_assignee_id uuid
)
  returns jsonb
  language plpgsql
  security invoker
as $$
declare
  v_result jsonb;
  v_got_row boolean := false;
begin
  begin
    with pgrst_source as (
      insert into public.tasks (title, creator_id, assignee_id)
      values ('__DIAGNOSTIC_TEST_DO_NOT_KEEP__', p_creator_id, p_assignee_id)
      returning id
    )
    select count(*) > 0 into v_got_row from pgrst_source;

    raise exception using message = '__DIAGNOSTIC_ROLLBACK__';
  exception
    when others then
      if sqlerrm = '__DIAGNOSTIC_ROLLBACK__' then
        v_result := jsonb_build_object('cte_returning_insert_would_succeed', true, 'got_row_back', v_got_row);
      else
        v_result := jsonb_build_object(
          'cte_returning_insert_would_succeed', false,
          'sqlstate', sqlstate,
          'message', sqlerrm
        );
      end if;
  end;
  return v_result;
end;
$$;

grant execute on function public.debug_try_task_insert_returning(uuid, uuid) to authenticated;
