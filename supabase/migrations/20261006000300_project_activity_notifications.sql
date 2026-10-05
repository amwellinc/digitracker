-- Migration 20261006000300: project activity → notifications for associates
-- (spec §3.1). The actor is never notified of their own action.

create or replace function public.notify_project_associates(
  p_project_id uuid, p_type text, p_message text, p_only_task uuid default null)
  returns void
  language sql security definer
  set search_path = public
as $$
  insert into public.notifications (user_id, type, message, read, project_id)
  select u.id, p_type, p_message, false, p_project_id
  from public.project_members pm
  join public.users u on u.id = pm.user_id
  where pm.project_id = p_project_id
    and u.role = 'Associate'
    and u.id is distinct from public.auth_user_app_id()
    and (p_only_task is null or exists (
      select 1 from public.project_task_assignees a
      where a.project_task_id = p_only_task and a.user_id = u.id))
$$;

create or replace function public.project_actor_name()
  returns text
  language sql security definer stable
  set search_path = public
as $$
  select coalesce((select name from public.users where id = public.auth_user_app_id()), 'Someone')
$$;

-- New task → every associate in the project.
create or replace function public.trg_project_task_created()
  returns trigger language plpgsql security definer set search_path = public
as $$
declare v_project text;
begin
  select name into v_project from public.projects where id = new.project_id;
  perform public.notify_project_associates(new.project_id, 'project_task_created',
    format('%s created a task in %s: "%s"', public.project_actor_name(), v_project, new.title));
  return new;
end;
$$;
drop trigger if exists project_task_created_notify on public.project_tasks;
create trigger project_task_created_notify after insert on public.project_tasks
  for each row execute function public.trg_project_task_created();

-- Status change → every associate in the project.
create or replace function public.trg_project_task_status()
  returns trigger language plpgsql security definer set search_path = public
as $$
declare v_project text;
begin
  if new.status is not distinct from old.status then return new; end if;
  select name into v_project from public.projects where id = new.project_id;
  perform public.notify_project_associates(new.project_id, 'project_task_status',
    format('%s moved "%s" in %s from %s to %s', public.project_actor_name(), new.title, v_project,
           replace(old.status, '_', ' '), replace(new.status, '_', ' ')));
  return new;
end;
$$;
drop trigger if exists project_task_status_notify on public.project_tasks;
create trigger project_task_status_notify after update of status on public.project_tasks
  for each row execute function public.trg_project_task_status();

-- Assignment → that associate only.
create or replace function public.trg_project_task_assigned()
  returns trigger language plpgsql security definer set search_path = public
as $$
declare v_task record;
begin
  if new.user_id is not distinct from public.auth_user_app_id() then return new; end if;
  if not exists (select 1 from public.users where id = new.user_id and role = 'Associate') then return new; end if;
  select t.title, t.project_id, p.name as project_name into v_task
    from public.project_tasks t join public.projects p on p.id = t.project_id
    where t.id = new.project_task_id;
  insert into public.notifications (user_id, type, message, read, project_id)
  values (new.user_id, 'project_task_assigned',
    format('%s assigned you a task in %s: "%s"', public.project_actor_name(), v_task.project_name, v_task.title),
    false, v_task.project_id);
  return new;
end;
$$;
drop trigger if exists project_task_assigned_notify on public.project_task_assignees;
create trigger project_task_assigned_notify after insert on public.project_task_assignees
  for each row execute function public.trg_project_task_assigned();

-- Comment → associates assigned to that task.
create or replace function public.trg_project_task_comment()
  returns trigger language plpgsql security definer set search_path = public
as $$
declare v_task record;
begin
  select t.title, t.project_id, p.name as project_name into v_task
    from public.project_tasks t join public.projects p on p.id = t.project_id
    where t.id = new.project_task_id;
  perform public.notify_project_associates(v_task.project_id, 'project_task_comment',
    format('%s commented on "%s" in %s', public.project_actor_name(), v_task.title, v_task.project_name),
    new.project_task_id);
  return new;
end;
$$;
drop trigger if exists project_task_comment_notify on public.project_task_comments;
create trigger project_task_comment_notify after insert on public.project_task_comments
  for each row execute function public.trg_project_task_comment();
