-- Migration 20261005000000: notify a user when they're added to a project.
--
-- Until now add_project_member only inserted the project_members row —
-- nobody was ever told. A member added from another workspace had no way of
-- knowing the project existed until they happened to look at their sidebar.
--
-- The notification is written here, inside the same transaction as the
-- membership insert, rather than from the client: notifications_insert RLS
-- would allow a client insert, but doing it server-side means every caller
-- (Super-Admin's ProjectDetailPanel, an Admin/Manager adding someone via
-- task assignment, or anything added later) gets it automatically and can't
-- forget it. The email half lives in the notify-project-member edge function
-- because it needs SMTP credentials.
--
-- Named with a timestamp, not 060_: the live migration history already holds
-- 20260927011921, and `supabase db push` refuses local migrations that sort
-- before the newest remote one.
--
-- Everything above the final insert is copied unchanged from
-- 058_project_member_self_service_add.sql.

alter table public.notifications drop constraint if exists notifications_type_check;

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
    return; -- already a member — no-op, not an error (and no repeat notification)
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

  if p_user_id is distinct from v_caller_id then
    insert into public.notifications (user_id, type, message, read)
    values (
      p_user_id,
      'project_added',
      format('%s added you to the project "%s" — find it in your sidebar as PROJECTS-%s.',
             coalesce(v_caller_name, 'An administrator'), v_project_name, v_project_name),
      false
    );
  end if;
end;
$$;

notify pgrst, 'reload schema';
