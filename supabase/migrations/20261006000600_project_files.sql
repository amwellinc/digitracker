-- Migration 20261006000600: Project Files & Folders (spec 2026-10-05-project-files-design.md §1).

-- ── Helpers ────────────────────────────────────────────────────────────────
-- Storage object names are arbitrary text; casting a non-UUID segment with
-- ::uuid would make a storage policy throw for every row it touches.
create or replace function public.try_uuid(p text)
  returns uuid
  language plpgsql immutable
as $$
begin
  return p::uuid;
exception when others then
  return null;
end;
$$;

-- ── Tables ─────────────────────────────────────────────────────────────────
create table public.project_folders (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  task_id      uuid references public.project_tasks(id) on delete cascade,
  parent_id    uuid references public.project_folders(id) on delete restrict,
  name         text not null check (length(trim(name)) between 1 and 100),
  is_task_root boolean not null default false,
  created_by   uuid references public.users(id) on delete set null,
  created_at   timestamptz not null default now()
);
create unique index project_folders_unique_name
  on public.project_folders (project_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name))
  where not is_task_root;
create unique index project_folders_one_task_root
  on public.project_folders (task_id) where is_task_root;
create index project_folders_project_idx on public.project_folders (project_id);

create table public.project_files (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  folder_id    uuid references public.project_folders(id) on delete restrict,
  task_id      uuid references public.project_tasks(id) on delete set null,
  bucket       text not null check (bucket in ('project-files', 'task-attachments')),
  storage_path text not null,
  name         text not null check (length(trim(name)) between 1 and 255),
  size_bytes   bigint,
  mime_type    text,
  uploaded_by  uuid references public.users(id) on delete set null,
  source       text not null check (source in ('folder', 'task', 'comment', 'import')),
  created_at   timestamptz not null default now(),
  unique (bucket, storage_path)
);
create index project_files_project_idx on public.project_files (project_id, created_at desc);
create index project_files_folder_idx on public.project_files (folder_id);
create index project_files_task_idx on public.project_files (task_id);

-- ── RLS ───────────────────────────────────────────────────────────────────
alter table public.project_folders enable row level security;
alter table public.project_files enable row level security;

create policy project_folders_select on public.project_folders
  for select using (public.is_project_member(project_id));
create policy project_folders_insert on public.project_folders
  for insert with check (
    public.is_project_member(project_id)
    and coalesce(public.auth_user_role(), '') in ('Admin', 'Manager', 'Super-Admin')
    and not is_task_root
    and (parent_id is null or exists (
      select 1 from public.project_folders p where p.id = parent_id and p.project_id = project_folders.project_id))
    and (task_id is null or exists (select 1 from public.project_tasks t where t.id = task_id and t.project_id = project_folders.project_id)));
create policy project_folders_update on public.project_folders
  for update using (
    public.is_project_member(project_id)
    and coalesce(public.auth_user_role(), '') in ('Admin', 'Manager', 'Super-Admin')
    and not is_task_root)
  with check (public.is_project_member(project_id) and not is_task_root);
create policy project_folders_delete on public.project_folders
  for delete using (
    public.is_project_member(project_id)
    and coalesce(public.auth_user_role(), '') in ('Admin', 'Manager', 'Super-Admin')
    and not is_task_root);

create policy project_files_select on public.project_files
  for select using (public.is_project_member(project_id));
create policy project_files_insert on public.project_files
  for insert with check (
    public.is_project_member(project_id)
    and uploaded_by = public.auth_user_app_id()
    and (folder_id is null or exists (
      select 1 from public.project_folders f where f.id = folder_id and f.project_id = project_files.project_id))
    and (task_id is null or exists (select 1 from public.project_tasks t where t.id = task_id and t.project_id = project_files.project_id))
    and (bucket <> 'project-files' or split_part(storage_path, '/', 1) = project_id::text));
create policy project_files_update on public.project_files
  for update using (
    public.is_project_member(project_id)
    and (uploaded_by = public.auth_user_app_id()
         or coalesce(public.auth_user_role(), '') in ('Admin', 'Manager', 'Super-Admin')))
  with check (
    public.is_project_member(project_id)
    and (folder_id is null or exists (
      select 1 from public.project_folders f where f.id = folder_id and f.project_id = project_files.project_id))
    and (task_id is null or exists (select 1 from public.project_tasks t where t.id = task_id and t.project_id = project_files.project_id)));
create policy project_files_delete on public.project_files
  for delete using (
    public.is_project_member(project_id)
    and (uploaded_by = public.auth_user_app_id()
         or coalesce(public.auth_user_role(), '') in ('Admin', 'Manager', 'Super-Admin')));

-- ── Column-level update limits ────────────────────────────────────────────
revoke update on public.project_folders from authenticated, anon;
grant update (name) on public.project_folders to authenticated;
revoke update on public.project_files from authenticated, anon;
grant update (name, folder_id, task_id) on public.project_files to authenticated;

-- ── Release files from a task's folders before the task (and folders) go ───
create or replace function public.project_tasks_release_files()
  returns trigger
  language plpgsql security definer
  set search_path = public
as $$
begin
  update public.project_files set folder_id = null
  where folder_id in (select id from public.project_folders where task_id = old.id);
  return old;
end;
$$;
revoke execute on function public.project_tasks_release_files() from public, anon, authenticated;
create trigger project_tasks_release_files
  before delete on public.project_tasks
  for each row execute function public.project_tasks_release_files();

-- ── Task root folder (parent of a task's sub-folders) ─────────────────────
create or replace function public.ensure_task_root_folder(p_task_id uuid)
  returns uuid
  language plpgsql security definer
  set search_path = public
as $$
declare
  v_project uuid;
  v_id      uuid;
begin
  select project_id into v_project from public.project_tasks where id = p_task_id;
  if v_project is null then
    raise exception 'Task not found';
  end if;
  if not public.is_project_member(v_project)
     or coalesce(public.auth_user_role(), '') not in ('Admin', 'Manager', 'Super-Admin') then
    raise exception 'Only Admins and Managers in this project can create folders' using errcode = '42501';
  end if;

  select id into v_id from public.project_folders where task_id = p_task_id and is_task_root;
  if v_id is not null then
    return v_id;
  end if;

  insert into public.project_folders (project_id, task_id, parent_id, name, is_task_root, created_by)
  values (v_project, p_task_id, null, 'task-root', true, public.auth_user_app_id())
  on conflict do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.project_folders where task_id = p_task_id and is_task_root;
  end if;
  return v_id;
end;
$$;
revoke execute on function public.ensure_task_root_folder(uuid) from public, anon;
grant execute on function public.ensure_task_root_folder(uuid) to authenticated;

-- ── Storage bucket + policies ─────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit)
values ('project-files', 'project-files', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

drop policy if exists project_files_obj_select on storage.objects;
create policy project_files_obj_select on storage.objects
  for select to authenticated
  using (bucket_id = 'project-files'
         and public.is_project_member(public.try_uuid((storage.foldername(name))[1])));

drop policy if exists project_files_obj_insert on storage.objects;
create policy project_files_obj_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'project-files'
              and public.is_project_member(public.try_uuid((storage.foldername(name))[1])));

drop policy if exists project_files_obj_delete on storage.objects;
create policy project_files_obj_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'project-files'
         and public.is_project_member(public.try_uuid((storage.foldername(name))[1]))
         and exists (
           select 1 from public.project_files f
           where f.bucket = 'project-files' and f.storage_path = storage.objects.name
             and (f.uploaded_by = public.auth_user_app_id()
                  or coalesce(public.auth_user_role(), '') in ('Admin', 'Manager', 'Super-Admin'))));

-- Associates: extend the restrictive storage scope (20261006000100) to
-- project-files objects of their own projects.
drop policy if exists storage_associate_scope on storage.objects;
create policy storage_associate_scope on storage.objects
  as restrictive for all to authenticated
  using (
    not (select public.is_associate())
    or (bucket_id = 'task-attachments' and exists (
      select 1 from public.project_tasks pt
      where pt.id::text = (storage.foldername(name))[1]
        and public.is_project_member(pt.project_id)))
    or (bucket_id = 'project-files'
        and public.is_project_member(public.try_uuid((storage.foldername(name))[1])))
  )
  with check (
    not (select public.is_associate())
    or (bucket_id = 'task-attachments' and exists (
      select 1 from public.project_tasks pt
      where pt.id::text = (storage.foldername(name))[1]
        and public.is_project_member(pt.project_id)))
    or (bucket_id = 'project-files'
        and public.is_project_member(public.try_uuid((storage.foldername(name))[1])))
  );

-- ── Associate allow-lists (redefined; originals in 20261006000100) ─────────
create or replace function public.associate_request_guard()
  returns void
  language plpgsql stable security definer
  set search_path = public
as $$
declare
  v_path text := current_setting('request.path', true);
begin
  if v_path is null or not public.is_associate() then
    return;
  end if;
  if v_path ~ '^/(projects|project_members|project_tasks|project_task_assignees|project_task_comments|notifications|users|project_folders|project_files)$'
     or v_path ~ '^/rpc/(get_project_member_status|is_project_member|check_account_status|is_associate|ensure_task_root_folder)$' then
    return;
  end if;
  raise exception 'Not available to associates' using errcode = '42501';
end;
$$;

create or replace function public.associate_lock_gaps()
  returns table (table_name text, problem text)
  language plpgsql security definer stable
  set search_path = public
as $$
begin
  if public.auth_user_role() is distinct from 'Super-Admin' then
    raise exception 'Super-Admin only';
  end if;
  return query
    select t.tablename::text, 'missing _deny_associates policy'::text
    from pg_tables t
    where t.schemaname = 'public'
      and t.tablename not in ('projects', 'project_members', 'project_tasks',
                              'project_task_assignees', 'project_task_comments',
                              'notifications', 'users', 'project_folders', 'project_files')
      and not exists (select 1 from pg_policies p
                      where p.schemaname = 'public' and p.tablename = t.tablename
                        and p.policyname = t.tablename || '_deny_associates')
    union all
    select c.relname::text, 'row level security disabled'::text
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
end;
$$;

notify pgrst, 'reload schema';
