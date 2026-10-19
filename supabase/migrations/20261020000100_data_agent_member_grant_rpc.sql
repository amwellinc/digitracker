-- Migration 20261020000100: Data Agent — grant team access via a
-- SECURITY DEFINER RPC (not a direct client insert), and notify the
-- granted user in-app.
--
-- Mirrors add_project_member (20261005000000_project_member_notifications.sql)
-- exactly: writing the notification inside the same server-side function
-- as the membership insert means every caller gets it automatically and
-- can't forget it, the way a client-side insert could. The notifications
-- table's own type check constraint was already dropped (and never
-- recreated) by that same migration, so no constraint change is needed
-- here to add 'data_agent_added' as a value.
create or replace function public.add_data_agent_member(p_sub_account text, p_user_id uuid)
  returns void
  language plpgsql security definer
  set search_path = public
as $$
declare
  v_caller_id   uuid := public.auth_user_app_id();
  v_caller_name text;
begin
  if not coalesce(
    public.auth_user_role() = 'Super-Admin'
    or (public.auth_user_role() = 'Admin' and public.auth_user_sub_account() = p_sub_account),
    false
  ) then
    raise exception 'Not authorized to add members for this sub-account';
  end if;

  if not exists (select 1 from public.data_agent_entitlements where sub_account = p_sub_account and enabled) then
    raise exception 'Data Agent is not enabled for this sub-account';
  end if;

  if exists (select 1 from public.data_agent_members where sub_account = p_sub_account and user_id = p_user_id) then
    return; -- already a member — no-op, not an error (and no repeat notification)
  end if;

  insert into public.data_agent_members (sub_account, user_id, added_by) values (p_sub_account, p_user_id, v_caller_id);

  if p_user_id is distinct from v_caller_id then
    select name into v_caller_name from public.users where id = v_caller_id;
    insert into public.notifications (user_id, type, message, read)
    values (
      p_user_id, 'data_agent_added',
      format('%s gave you Data Agent access for %s — find it in the left menu.', coalesce(v_caller_name, 'An administrator'), p_sub_account),
      false
    );
  end if;
end;
$$;
revoke execute on function public.add_data_agent_member(text, uuid) from public, anon;
grant execute on function public.add_data_agent_member(text, uuid) to authenticated;

-- The old client-side INSERT policy let DataAgentTeamAccess's direct
-- `supabase.from('data_agent_members').insert(...)` bypass the RPC (and
-- thus the notification) entirely — removing it forces every grant
-- through add_data_agent_member above. There is still no UPDATE/DELETE
-- client policy, so this makes the table fully default-deny for direct
-- client writes, matching data_agent_connections' own pattern.
drop policy if exists data_agent_members_write on public.data_agent_members;
