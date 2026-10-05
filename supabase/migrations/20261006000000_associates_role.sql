-- Migration 20261006000000: Associate role foundation.
-- See docs/superpowers/specs/2026-10-05-project-associates-design.md §1.

alter table public.users drop constraint if exists users_role_check;
alter table public.users add constraint users_role_check
  check (role in ('Super-Admin', 'Admin', 'Manager', 'Staff', 'Associate'));

-- Associates, and only associates, live in the ASSOCIATE sentinel workspace.
alter table public.users add constraint users_associate_sub_account
  check ((role = 'Associate') = (sub_account = 'ASSOCIATE'));

alter table public.sub_accounts add constraint sub_accounts_code_not_reserved
  check (upper(code) <> 'ASSOCIATE');

-- Deliberately ignores users.status: a suspended associate must still be
-- locked out by every *_deny_associates policy.
create or replace function public.is_associate()
  returns boolean
  language sql security definer stable
  set search_path = public
as $$
  select coalesce(
    (select role = 'Associate' from public.users
      where lower(email) = lower(auth.email()) limit 1),
    false)
$$;
grant execute on function public.is_associate() to authenticated;

-- Lets the email function link straight to the project.
alter table public.notifications
  add column if not exists project_id uuid references public.projects(id) on delete cascade;

create or replace function public.sub_account_seat_count(p_sub_account text)
  returns int
  language sql security definer stable
as $$
  select count(*)::int from public.users
  where sub_account = p_sub_account and role <> 'Associate'
$$;

-- add_project_member: copied from 20261005000000 with three changes —
-- (1) associates don't count toward / aren't blocked by the 3-workspace cap,
-- (2) the notification records project_id,
-- (3) adding an associate reactivates a suspended associate account.
create or replace function public.add_project_member(p_project_id uuid, p_user_id uuid)
  returns void
  language plpgsql security definer
  set search_path = public
as $$
declare
  v_caller_id     uuid;
  v_caller_name   text;
  v_caller_role   text;
  v_caller_sub    text;
  v_target_sub    text;
  v_distinct_subs int;
  v_project_name  text;
begin
  select id, name, role, sub_account into v_caller_id, v_caller_name, v_caller_role, v_caller_sub
    from public.users where lower(email) = lower(auth.email()) and status = 'active';

  if v_caller_role is distinct from 'Super-Admin' then
    if v_caller_role not in ('Admin', 'Manager') then
      raise exception 'Only Super-Admin, or an Admin/Manager who is already a project member, can add project members';
    end if;
    if not public.is_project_member(p_project_id) then
      raise exception 'You must be a member of this project to add others to it';
    end if;
  end if;

  select name into v_project_name from public.projects where id = p_project_id;
  if v_project_name is null then
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
    return;
  end if;

  if v_target_sub <> 'ASSOCIATE' then
    select count(distinct u.sub_account) into v_distinct_subs
      from public.project_members pm
      join public.users u on u.id = pm.user_id
      where pm.project_id = p_project_id and u.sub_account <> 'ASSOCIATE';

    if v_distinct_subs >= 3 and not exists (
      select 1 from public.project_members pm2
      join public.users u2 on u2.id = pm2.user_id
      where pm2.project_id = p_project_id and u2.sub_account = v_target_sub
    ) then
      raise exception 'This project already has members from 3 workspaces — remove one before adding a member from a 4th.';
    end if;
  else
    update public.users set status = 'active' where id = p_user_id and status <> 'active';
  end if;

  insert into public.project_members (project_id, user_id) values (p_project_id, p_user_id);

  if p_user_id is distinct from v_caller_id then
    insert into public.notifications (user_id, type, message, read, project_id)
    values (
      p_user_id,
      'project_added',
      format('%s added you to the project "%s" — find it in your sidebar as PROJECTS-%s.',
             coalesce(v_caller_name, 'An administrator'), v_project_name, v_project_name),
      false,
      p_project_id
    );
  end if;
end;
$$;

-- remove_project_member: same authorization as 055, plus suspend an
-- associate who no longer belongs to any project.
create or replace function public.remove_project_member(p_project_id uuid, p_user_id uuid)
  returns void
  language plpgsql security definer
  set search_path = public
as $$
begin
  if public.auth_user_role() is distinct from 'Super-Admin' then
    raise exception 'Only Super-Admin can manage project membership';
  end if;

  delete from public.project_members where project_id = p_project_id and user_id = p_user_id;

  update public.users u set status = 'suspended'
   where u.id = p_user_id
     and u.role = 'Associate'
     and not exists (select 1 from public.project_members pm where pm.user_id = p_user_id);
end;
$$;

-- get_project_member_status gains `role` (return type change → drop first).
drop function if exists public.get_project_member_status(uuid);
create function public.get_project_member_status(p_project_id uuid)
  returns table (
    user_id          uuid,
    name             text,
    profile_image    text,
    role             text,
    status           text,
    last_activity_at timestamptz
  )
  language sql security definer stable
as $$
  select distinct on (u.id)
    u.id, u.name, u.profile_image, u.role, tl.status, tl.last_activity_at
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

notify pgrst, 'reload schema';
