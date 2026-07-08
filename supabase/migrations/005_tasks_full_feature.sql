-- ============================================================
-- Task assignees junction table (supports team/multi-user tasks)
-- ============================================================
create table if not exists public.task_assignees (
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  primary key (task_id, user_id)
);
alter table public.task_assignees enable row level security;

create policy "task_assignees_select" on public.task_assignees
  for select using (
    user_id = auth.uid()
    or exists (select 1 from public.tasks t where t.id = task_id and t.creator_id = auth.uid())
    or public.auth_user_role() in ('Super-admin', 'Manager')
  );
create policy "task_assignees_insert" on public.task_assignees
  for insert with check (
    exists (select 1 from public.tasks t where t.id = task_id and t.creator_id = auth.uid())
    or public.auth_user_role() in ('Super-admin', 'Manager')
  );
create policy "task_assignees_delete" on public.task_assignees
  for delete using (
    exists (select 1 from public.tasks t where t.id = task_id and t.creator_id = auth.uid())
    or public.auth_user_role() in ('Super-admin', 'Manager')
  );

-- ============================================================
-- Extend tasks table
-- ============================================================
-- Widen status to include closed + archived
alter table public.tasks drop constraint if exists tasks_status_check;
alter table public.tasks add constraint tasks_status_check
  check (status in ('pending', 'in_progress', 'completed', 'closed', 'archived'));

-- Attachments stored as JSONB array: [{url, name, size, type}]
alter table public.tasks add column if not exists attachments jsonb not null default '[]'::jsonb;

-- Widen tasks SELECT so assignees in junction table can also see the task
drop policy if exists "tasks_select" on public.tasks;
create policy "tasks_select" on public.tasks
  for select using (
    creator_id = auth.uid()
    or assignee_id = auth.uid()
    or exists (
      select 1 from public.task_assignees ta
      where ta.task_id = id and ta.user_id = auth.uid()
    )
    or public.auth_user_role() in ('Super-admin', 'Manager')
  );

-- Allow junction-table assignees to update task status (mark complete etc.)
drop policy if exists "tasks_update" on public.tasks;
create policy "tasks_update" on public.tasks
  for update using (
    creator_id = auth.uid()
    or assignee_id = auth.uid()
    or exists (
      select 1 from public.task_assignees ta
      where ta.task_id = id and ta.user_id = auth.uid()
    )
    or public.auth_user_role() in ('Super-admin', 'Manager')
  );

-- ============================================================
-- Task comments: allow task participants to see all comments
-- ============================================================
drop policy if exists "task_comments_select" on public.task_comments;
create policy "task_comments_select" on public.task_comments
  for select using (
    user_id = auth.uid()
    or public.auth_user_role() in ('Super-admin', 'Manager')
    or exists (
      select 1 from public.tasks t
      where t.id = task_id
        and (t.creator_id = auth.uid() or t.assignee_id = auth.uid())
    )
    or exists (
      select 1 from public.task_assignees ta
      where ta.task_id = task_id and ta.user_id = auth.uid()
    )
  );

-- Task comment participants can comment
drop policy if exists "task_comments_insert" on public.task_comments;
create policy "task_comments_insert" on public.task_comments
  for insert with check (
    user_id = auth.uid()
    and (
      exists (
        select 1 from public.tasks t
        where t.id = task_id
          and (t.creator_id = auth.uid() or t.assignee_id = auth.uid())
      )
      or exists (
        select 1 from public.task_assignees ta
        where ta.task_id = task_id and ta.user_id = auth.uid()
      )
      or public.auth_user_role() in ('Super-admin', 'Manager')
    )
  );

-- ============================================================
-- Notifications: drop type constraint so we can add new types
-- ============================================================
DO $$ BEGIN
  ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Allow authenticated users to insert notifications for OTHER users
-- (needed for cross-user task notifications)
drop policy if exists "notifications_insert" on public.notifications;
create policy "notifications_insert" on public.notifications
  for insert with check (auth.role() = 'authenticated');

-- ============================================================
-- Storage: task-attachments bucket
-- ============================================================
insert into storage.buckets (id, name, public)
values ('task-attachments', 'task-attachments', false)
on conflict (id) do nothing;

drop policy if exists "task_attach_upload" on storage.objects;
create policy "task_attach_upload" on storage.objects
  for insert with check (bucket_id = 'task-attachments' and auth.role() = 'authenticated');

drop policy if exists "task_attach_read" on storage.objects;
create policy "task_attach_read" on storage.objects
  for select using (bucket_id = 'task-attachments' and auth.role() = 'authenticated');

drop policy if exists "task_attach_delete" on storage.objects;
create policy "task_attach_delete" on storage.objects
  for delete using (bucket_id = 'task-attachments' and auth.role() = 'authenticated');

-- ============================================================
-- Realtime
-- ============================================================
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.task_comments; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.task_assignees; EXCEPTION WHEN OTHERS THEN NULL; END $$;
