-- Migration 058: Let an Admin/Manager add same-workspace users to a project
-- they already belong to, via task assignment.
--
-- Previously add_project_member was Super-Admin only. Assigning a task to
-- someone in a project requires them to actually be a project member (RLS
-- gates project_tasks visibility on is_project_member), so without this,
-- an Admin/Manager could only ever assign tasks to whoever Super-Admin had
-- already added — a real bottleneck for day-to-day project work.
--
-- Safe to loosen: a non-Super-Admin caller may only add someone from their
-- OWN sub_account, and only to a project they are already a member of
-- themselves. Since the caller's own workspace is by definition already
-- represented in the project's member list, adding another person from
-- that same workspace can never push the project past the 3-workspace cap
-- (see add_project_member's own cap-counting logic below, unchanged) —
-- this capability cannot be used to bypass Super-Admin's control over
-- which *workspaces* participate in a project, only who *within* an
-- already-participating workspace does.

create or replace function public.add_project_member(p_project_id uuid, p_user_id uuid)
  returns void
  language plpgsql security definer
  set search_path = public
as $$
declare
  v_caller_role   text;
  v_caller_sub    text;
  v_target_sub    text;
  v_distinct_subs int;
begin
  select role, sub_account into v_caller_role, v_caller_sub
    from public.users where lower(email) = lower(auth.email()) and status = 'active';

  if v_caller_role is distinct from 'Super-Admin' then
    if v_caller_role not in ('Admin', 'Manager') then
      raise exception 'Only Super-Admin, or an Admin/Manager who is already a project member, can add project members';
    end if;
    if not public.is_project_member(p_project_id) then
      raise exception 'You must be a member of this project to add others to it';
    end if;
  end if;

  if not exists (select 1 from public.projects where id = p_project_id) then
    raise exception 'Project not found';
  end if;

  select sub_account into v_target_sub from public.users where id = p_user_id;
  if v_target_sub is null then
    raise exception 'User not found';
  end if;

  if v_caller_role is distinct from 'Super-Admin' and v_target_sub is distinct from v_caller_sub then
    raise exception 'You can only add members from your own workspace';
  end if;

  if exists (
    select 1 from public.project_members
    where project_id = p_project_id and user_id = p_user_id
  ) then
    return; -- already a member — no-op, not an error
  end if;

  select count(distinct u.sub_account) into v_distinct_subs
    from public.project_members pm
    join public.users u on u.id = pm.user_id
    where pm.project_id = p_project_id;

  if v_distinct_subs >= 3 and not exists (
    select 1 from public.project_members pm2
    join public.users u2 on u2.id = pm2.user_id
    where pm2.project_id = p_project_id and u2.sub_account = v_target_sub
  ) then
    raise exception 'This project already has members from 3 workspaces — remove one before adding a member from a 4th.';
  end if;

  insert into public.project_members (project_id, user_id) values (p_project_id, p_user_id);
end;
$$;

notify pgrst, 'reload schema';
