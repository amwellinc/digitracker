-- Migration 20261006000300: project activity → notifications for associates
-- (spec §3.1). The actor is never notified of their own action. When the actor
-- is an associate, internal task participants are notified here too (the
-- client can't insert notifications on an associate's behalf).

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
revoke execute on function public.notify_project_associates(uuid, text, text, uuid) from public, anon, authenticated;

create or replace function public.project_actor_name()
  returns text
  language sql security definer stable
  set search_path = public
as $$
  select coalesce((select name from public.users where id = public.auth_user_app_id()), 'Someone')
$$;
revoke execute on function public.project_actor_name() from public, anon, authenticated;

-- Associates can't insert notifications (notifications_associate_no_insert), so
-- ProjectTaskDetailModal skips its own task_reply/task_* loop for associate
-- actors. When the actor IS an associate, the triggers below call this to give
-- the task's internal (non-associate) assignees — and optionally its creator —
-- the same in-app notification the client would have sent. Callers must only
-- use it for associate actors, or internal users would be notified twice.
-- Types don't start with 'project_', so 20261006000400 never emails them.
create or replace function public.notify_task_internal_members(
  p_task_id uuid, p_type text, p_message text, p_include_creator boolean)
  returns void
  language sql security definer
  set search_path = public
as $$
  insert into public.notifications (user_id, type, message, read, project_id)
  select r.user_id, p_type, p_message, false, t.project_id
  from public.project_tasks t
  cross join lateral (
    select a.user_id from public.project_task_assignees a where a.project_task_id = t.id
    union
    select t.creator_id where p_include_creator
  ) r
  join public.users u on u.id = r.user_id
  where t.id = p_task_id
    and u.role is distinct from 'Associate'
    and r.user_id is distinct from public.auth_user_app_id()
$$;
revoke execute on function public.notify_task_internal_members(uuid, text, text, boolean) from public, anon, authenticated;

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
  if public.is_associate() then
    -- Mirrors ProjectTaskDetailModal.updateStatus (STATUS_LABEL = initcap, e.g. 'In Progress').
    perform public.notify_task_internal_members(new.id,
      case new.status when 'completed' then 'task_completed'
                      when 'closed'    then 'task_closed'
                      else 'task_assigned' end,
      format('Task "%s" was marked %s by %s', new.title,
             initcap(replace(new.status, '_', ' ')), public.project_actor_name()),
      new.status in ('completed', 'closed'));
  end if;
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
  if public.is_associate() then
    -- Mirrors ProjectTaskDetailModal.postComment.
    perform public.notify_task_internal_members(new.project_task_id, 'task_reply',
      format('%s replied to task "%s"', public.project_actor_name(), v_task.title),
      true);
  end if;
  return new;
end;
$$;
drop trigger if exists project_task_comment_notify on public.project_task_comments;
create trigger project_task_comment_notify after insert on public.project_task_comments
  for each row execute function public.trg_project_task_comment();
