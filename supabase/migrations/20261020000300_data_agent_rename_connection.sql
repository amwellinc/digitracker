-- Migration 20261020000300: Data Agent — let an Admin rename a
-- connection's project name after creation.
--
-- When connections moved from one-per-sub-account to many
-- (20261019000300), every pre-existing connection got backfilled with the
-- literal label 'Default Connection' since no real name existed yet.
-- There was no way to change it afterward: delete_data_agent_connection
-- refuses to remove a connection with migration history (by design, to
-- protect undo/history), which is exactly the state any connection in
-- real use is in — so a name set at creation, or backfilled, was
-- permanent. This adds the missing rename path, matching
-- update_data_agent_connection_token's own pattern.
create or replace function public.update_data_agent_connection_label(p_connection_id uuid, p_label text)
  returns void
  language plpgsql security definer
  set search_path = public
as $$
declare
  v_sub_account text;
begin
  select sub_account into v_sub_account from public.data_agent_connections where id = p_connection_id;
  if v_sub_account is null then raise exception 'Connection not found'; end if;
  if not coalesce(
    public.auth_user_role() = 'Super-Admin'
    or (public.auth_user_role() = 'Admin' and public.auth_user_sub_account() = v_sub_account),
    false
  ) then
    raise exception 'Not authorized to rename this connection';
  end if;
  if length(trim(coalesce(p_label, ''))) = 0 then raise exception 'A project name is required'; end if;

  update public.data_agent_connections set label = trim(p_label) where id = p_connection_id;
end;
$$;
revoke execute on function public.update_data_agent_connection_label(uuid, text) from public, anon;
grant execute on function public.update_data_agent_connection_label(uuid, text) to authenticated;
