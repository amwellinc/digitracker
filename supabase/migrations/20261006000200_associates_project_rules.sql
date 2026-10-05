-- Migration 20261006000200: associate permissions inside projects (spec §1.3).
-- Reads, comments, and attachments are already granted to every member by
-- 055's policies; these RESTRICTIVE policies only narrow what associates write.

create or replace function public.is_project_task_assignee(p_task_id uuid)
  returns boolean
  language sql security definer stable
  set search_path = public
as $$
  select exists (
    select 1 from public.project_task_assignees
    where project_task_id = p_task_id and user_id = public.auth_user_app_id()
  )
$$;

drop policy if exists project_tasks_associate_update on public.project_tasks;
create policy project_tasks_associate_update on public.project_tasks
  as restrictive for update to authenticated
  using (not public.is_associate() or public.is_project_task_assignee(id));

drop policy if exists project_tasks_associate_no_insert on public.project_tasks;
create policy project_tasks_associate_no_insert on public.project_tasks
  as restrictive for insert to authenticated with check (not public.is_associate());

drop policy if exists project_tasks_associate_no_delete on public.project_tasks;
create policy project_tasks_associate_no_delete on public.project_tasks
  as restrictive for delete to authenticated using (not public.is_associate());

drop policy if exists project_task_assignees_associate_no_insert on public.project_task_assignees;
create policy project_task_assignees_associate_no_insert on public.project_task_assignees
  as restrictive for insert to authenticated with check (not public.is_associate());
drop policy if exists project_task_assignees_associate_no_update on public.project_task_assignees;
create policy project_task_assignees_associate_no_update on public.project_task_assignees
  as restrictive for update to authenticated using (not public.is_associate());
drop policy if exists project_task_assignees_associate_no_delete on public.project_task_assignees;
create policy project_task_assignees_associate_no_delete on public.project_task_assignees
  as restrictive for delete to authenticated using (not public.is_associate());

-- RLS can't restrict columns, so a trigger enforces "status only".
create or replace function public.project_tasks_associate_status_only()
  returns trigger
  language plpgsql
  set search_path = public
as $$
begin
  if public.is_associate() and (
       new.title       is distinct from old.title
    or new.description is distinct from old.description
    or new.assignee_id is distinct from old.assignee_id
    or new.due_date    is distinct from old.due_date
    or new.recurring   is distinct from old.recurring
    or new.attachments is distinct from old.attachments
    or new.project_id  is distinct from old.project_id
    or new.creator_id  is distinct from old.creator_id
  ) then
    raise exception 'Associates can only change a task''s status' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists project_tasks_associate_status_only on public.project_tasks;
create trigger project_tasks_associate_status_only
  before update on public.project_tasks
  for each row execute function public.project_tasks_associate_status_only();
