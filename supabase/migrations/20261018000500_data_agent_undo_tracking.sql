-- Migration 20261018000500: Data Agent — per-record undo tracking and the
-- undo-request gate (spec §9). Numbered 000500, not 000300 — Task 15's
-- and Task 16's own fix rounds already claimed 000300/000400 for their
-- own new migrations after this task's brief was first written; this is
-- a filename-collision fix, not a design change.

alter table public.data_agent_migration_records
  add column undo_status text check (undo_status in ('pending', 'done', 'failed'));

create or replace function public.request_data_agent_undo(p_migration_id uuid)
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
  -- is_data_agent_member() always returns true/false, never null (see its
  -- own definition) — the explicit "is not true" here is defense in
  -- depth, not a workaround: this is the single authorization gate before
  -- a real CRM write, and must stay correct even if a future edit to that
  -- function's body ever reintroduced a NULL path.
  if coalesce(public.is_data_agent_member(v_sub_account), false) is not true then
    raise exception 'Not authorized for this migration';
  end if;
  if v_status <> 'completed' then
    raise exception 'Only a completed migration can be undone (current status: %)', v_status;
  end if;

  update public.data_agent_migration_records
    set undo_status = 'pending'
    where migration_id = p_migration_id and write_status in ('created', 'replaced');

  update public.data_agent_migrations set status = 'undoing' where id = p_migration_id;
end;
$$;
revoke execute on function public.request_data_agent_undo(uuid) from public, anon;
grant execute on function public.request_data_agent_undo(uuid) to authenticated;
