-- Migration 20261020000400: Data Agent — let a migration be cancelled.
--
-- 'cancelled' has been a valid data_agent_migrations.status value since
-- the table was first created, but there was never any RPC or UI path
-- that could actually set it — a migration stuck at any pre-completion
-- status (e.g. 'migrating' forever, if the worker's cron secret was
-- never configured — a real live incident) had no way out at all.
create or replace function public.cancel_data_agent_migration(p_migration_id uuid)
  returns void
  language plpgsql security definer
  set search_path = public
as $$
declare
  v_sub_account text;
  v_status text;
begin
  select sub_account, status into v_sub_account, v_status from public.data_agent_migrations where id = p_migration_id;
  if v_sub_account is null then
    raise exception 'Migration not found';
  end if;
  -- is_data_agent_member() always returns true/false, never null — the
  -- explicit "is not true" is defense in depth, matching every other
  -- gate in this feature (see confirm_data_agent_migration's own comment
  -- on why this must stay correct even if that function's body changes).
  if coalesce(public.is_data_agent_member(v_sub_account), false) is not true then
    raise exception 'Not authorized for this migration';
  end if;

  if v_status not in ('uploaded', 'mapping', 'awaiting_confirmation', 'migrating', 'verifying') then
    raise exception 'This migration cannot be cancelled from its current status (%)', v_status;
  end if;

  -- A stop, not an undo: any row the worker hasn't claimed/written yet is
  -- permanently skipped (its own claim loop only ever looks at
  -- write_status = 'pending', so this alone keeps it from writing
  -- anything further here on its next tick). Rows already written
  -- (write_status created/replaced) are left exactly as they are —
  -- Undo (available once a migration reaches completed/
  -- completed_with_errors) remains the tool for reverting those.
  update public.data_agent_migration_records
    set write_status = 'skipped'
    where migration_id = p_migration_id and write_status = 'pending';

  update public.data_agent_migrations
    set status = 'cancelled', claimed_at = null
    where id = p_migration_id;
end;
$$;
revoke execute on function public.cancel_data_agent_migration(uuid) from public, anon;
grant execute on function public.cancel_data_agent_migration(uuid) to authenticated;
