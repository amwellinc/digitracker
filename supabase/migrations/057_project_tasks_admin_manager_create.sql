-- Migration 057: Restrict project task creation to Admin/Manager/Super-Admin
--
-- Projects are meant to consist of tasks created by Admin/Manager and worked
-- by the full membership (any member can still view, be assigned, comment
-- on, and progress a task's status) -- creation itself is now gated by the
-- caller's existing company-wide role, reusing auth_user_role() rather than
-- introducing a separate per-project role.

drop policy if exists "project_tasks_insert" on public.project_tasks;

create policy "project_tasks_insert" on public.project_tasks
  for insert with check (
    public.is_project_member(project_id)
    and creator_id = public.auth_user_app_id()
    and public.auth_user_role() in ('Admin', 'Manager', 'Super-Admin')
  );

notify pgrst, 'reload schema';
