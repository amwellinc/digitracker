# Project Files & Folders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a members-only Files tab to every Project — a Common view of every project file, a folder per task with Admin/Manager sub-folders — route all project uploads through it, and import existing task/comment attachments with non-expiring access.

**Architecture:** Two new tables (`project_folders`, `project_files`) with RLS keyed on `is_project_member`, a new private `project-files` bucket whose object paths start with the project id, storage policies keyed on that id, and associate allow-list updates. A pure TS module (`projectFiles.ts`) owns upload, signing, legacy-URL parsing and the folder tree; a `ProjectFilesTab` component renders it; an `AttachmentLink` component re-signs links on click.

**Tech Stack:** Supabase Postgres (RLS, plpgsql, storage policies), React 18 + TS + react-router-dom 6 (HashRouter, `useSearchParams`), Tailwind, Vitest + Testing Library, `corepack pnpm`.

**Spec:** [docs/superpowers/specs/2026-10-05-project-files-design.md](../specs/2026-10-05-project-files-design.md)

**Repo:** `/Users/arunkemer/DIGI5Y/digitracker`, branch `feat/project-files`.

## Global Constraints

- New migrations are timestamp-named after `20261006000500`: use `20261006000600_project_files.sql` and `20261006000700_project_files_import.sql`. Never edit an applied migration (everything ≤ `20261006000500` is live).
- Bucket id exactly `project-files`; object path exactly `<project_id>/<file_id>/<original file name>`; 50 MB limit (`52428800`).
- `project_files.source` ∈ `folder | task | comment | import`; `project_files.bucket` ∈ `project-files | task-attachments`.
- Folder management (create/rename/delete): Admin, Manager, Super-Admin project members only. File rename/move/delete: uploader, or Admin/Manager/Super-Admin member. View/upload: any member (incl. associates).
- Folders must be empty to delete (enforced by `on delete restrict`).
- Download links: fresh signed URL, 300 s.
- Task folders are labelled `Task: <current task title>`; Common is all project files newest first.
- URL state: `?tab=files&folder=common|task:<taskId>|<folderId>` on `/projects/:projectId`.
- Uploads create no notifications.
- Associates: both new tables are project tables (added to every associate allow-list); associates may read/upload `project-files` objects of their projects.
- File paths in user-facing chat are markdown links (user preference). Commits: conventional, ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Commands: `corepack pnpm vitest run [path]`, `corepack pnpm tsc --noEmit`.

## Review Focus

1. **Non-UUID first path segment** in `storage.objects` (e.g. existing `task-attachments` objects named `<taskId>/…` or junk) must not make storage policies throw — `try_uuid()` returns null and `is_project_member(null)` is false (pinned by static test in Task 1).
2. **File names with spaces/unicode/`%`** — upload path keeps the original name; legacy URL parsing decodes `%20`/UTF-8 correctly and returns null for malformed encodings (Task 3 tests; SQL `url_decode` returns null on bad input, Task 2).
3. **Row insert fails after object upload** (e.g. RLS) — the uploaded object is removed and the error surfaced, not left orphaned (Task 3 test).
4. **Deleting a non-empty folder** shows "Folder must be empty" instead of a raw FK error (Task 5 test).
5. **Associate on the Files tab** sees no New-folder button and no Rename/Move/Delete on others' files, but can upload (Task 5 test).

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20261006000600_project_files.sql` | Tables, indexes, RLS, `try_uuid`, `ensure_task_root_folder`, bucket + storage policies, associate storage scope, guard + lock-gaps redefinition |
| `supabase/migrations/20261006000700_project_files_import.sql` | `url_decode`, one-time idempotent import of existing attachments |
| `src/__tests__/associateLock.test.ts` | Updated allow-lists; guard read from newest definition; new static checks |
| `src/types/index.ts` | `ProjectFolder`, `ProjectFile`, `StoredAttachment` |
| `src/features/projects/files/projectFiles.ts` | Upload, delete, sign, legacy parse, folder tree, view filtering, breadcrumbs |
| `src/features/projects/files/AttachmentLink.tsx` | Chip that signs fresh on click |
| `src/features/projects/files/ProjectFilesTab.tsx` | Files tab UI |
| `src/features/projects/ProjectPage.tsx` | Tasks/Files tab switch |
| `src/features/projects/ProjectTaskDetailModal.tsx`, `CreateProjectTaskModal.tsx` | Upload via `uploadProjectFile`, render `AttachmentLink` |

---

### Task 1: Files schema, security, and associate allow-lists

**Files:**
- Create: `supabase/migrations/20261006000600_project_files.sql`
- Modify: `src/__tests__/associateLock.test.ts`

**Interfaces:**
- Produces: tables `project_folders`, `project_files` (columns per SQL); RPC `ensure_task_root_folder(p_task_id uuid) returns uuid`; SQL `public.try_uuid(text) returns uuid`; bucket `project-files`.

- [ ] **Step 1: Update the static test (RED)**

In `src/__tests__/associateLock.test.ts`:
1. Change `PROJECT_TABLES` to
   `['projects', 'project_members', 'project_tasks', 'project_task_assignees', 'project_task_comments', 'notifications', 'users', 'project_folders', 'project_files']`.
2. Replace the body of the existing test `'pre-request guard only allows project tables and safe RPCs'` so it reads the **newest** migration that defines the guard:

```ts
  it('pre-request guard only allows project tables and safe RPCs', () => {
    const definers = files.filter(f => /function public\.associate_request_guard\(\)/.test(read(f)))
    const sql = read(definers[definers.length - 1])
    const tables = sql.match(/v_path ~ '\^\/\(([^)]+)\)\$'/)?.[1].split('|') ?? []
    const rpcs = sql.match(/v_path ~ '\^\/rpc\/\(([^)]+)\)\$'/)?.[1].split('|') ?? []
    expect(tables.sort()).toEqual([...PROJECT_TABLES].sort())
    expect(rpcs.sort()).toEqual(['check_account_status', 'ensure_task_root_folder', 'get_project_member_status', 'is_associate', 'is_project_member'])
  })
```
3. Append:

```ts
describe('project files security', () => {
  const sql = () => read('20261006000600_project_files.sql')
  it('casts storage path segments with try_uuid, never a bare ::uuid', () => {
    expect(sql()).toMatch(/function public\.try_uuid\(/)
    expect(sql()).not.toMatch(/\(storage\.foldername\(name\)\)\[1\]\)?::uuid/)
  })
  it('creates member-only policies on both tables and the bucket', () => {
    for (const p of ['project_folders_select', 'project_folders_insert', 'project_folders_update', 'project_folders_delete',
      'project_files_select', 'project_files_insert', 'project_files_update', 'project_files_delete',
      'project_files_obj_select', 'project_files_obj_insert', 'project_files_obj_delete']) expect(sql()).toContain(p)
  })
  it('lets associates reach project-files objects of their projects', () => {
    expect(sql()).toMatch(/storage_associate_scope[\s\S]*bucket_id = 'project-files'/)
  })
})
```

Run: `corepack pnpm vitest run src/__tests__/associateLock.test.ts`
Expected: FAIL (guard allow-list mismatch; missing migration file).

- [ ] **Step 2: Write the migration**

```sql
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
      select 1 from public.project_folders p where p.id = parent_id and p.project_id = project_folders.project_id)));
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
      select 1 from public.project_folders f where f.id = folder_id and f.project_id = project_files.project_id)));
create policy project_files_update on public.project_files
  for update using (
    public.is_project_member(project_id)
    and (uploaded_by = public.auth_user_app_id()
         or coalesce(public.auth_user_role(), '') in ('Admin', 'Manager', 'Super-Admin')))
  with check (
    public.is_project_member(project_id)
    and (folder_id is null or exists (
      select 1 from public.project_folders f where f.id = folder_id and f.project_id = project_files.project_id)));
create policy project_files_delete on public.project_files
  for delete using (
    public.is_project_member(project_id)
    and (uploaded_by = public.auth_user_app_id()
         or coalesce(public.auth_user_role(), '') in ('Admin', 'Manager', 'Super-Admin')));

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
```

Before writing `associate_lock_gaps`, open `supabase/migrations/20261006000100_associates_lock.sql` and copy its current definition's tail verbatim (the `union all … relrowsecurity` part) — the version above must match it except for the two added table names. Same for `associate_request_guard`: confirm the only differences from the 0100 version are the added names.

- [ ] **Step 3: Run tests (GREEN)**

Run: `corepack pnpm vitest run src/__tests__/associateLock.test.ts` → PASS; then `corepack pnpm tsc --noEmit` and `corepack pnpm vitest run` → all pass.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20261006000600_project_files.sql src/__tests__/associateLock.test.ts
git commit -m "feat: add project files and folders schema, storage, and associate allow-lists"
```

---

### Task 2: One-time import of existing attachments

**Files:**
- Create: `supabase/migrations/20261006000700_project_files_import.sql`
- Modify: `src/__tests__/associateLock.test.ts` (append)

**Interfaces:**
- Consumes: `project_files` (Task 1).
- Produces: SQL `public.url_decode(text) returns text` (null on malformed input).

- [ ] **Step 1: Append failing static test**

```ts
describe('project files import', () => {
  const sql = () => read('20261006000700_project_files_import.sql')
  it('is idempotent and only imports objects that still exist', () => {
    expect(sql().match(/on conflict \(bucket, storage_path\) do nothing/g)).toHaveLength(2)
    expect(sql().match(/from storage\.objects o\s+where o\.bucket_id = 'task-attachments'/g)).toHaveLength(2)
    expect(sql()).toContain("'import'")
  })
  it('decodes URL paths with a null-on-error url_decode', () => {
    expect(sql()).toMatch(/function public\.url_decode\(/)
    expect(sql()).toMatch(/exception when others then\s+return null/)
  })
})
```
Run focused test → FAIL (file missing).

- [ ] **Step 2: Write the migration**

```sql
-- Migration 20261006000700: import existing project task/comment attachments
-- into project_files (spec §2.3). Idempotent; nothing is moved or deleted.
-- Stored attachment URLs look like
--   https://<ref>.supabase.co/storage/v1/object/sign/task-attachments/<url-encoded path>?token=…
-- The path survives even after the token expired.

create or replace function public.url_decode(p_input text)
  returns text
  language plpgsql immutable
as $$
declare
  v_bytes bytea := ''::bytea;
  i       int := 1;
  n       int := length(p_input);
  ch      text;
begin
  if p_input is null then
    return null;
  end if;
  while i <= n loop
    ch := substr(p_input, i, 1);
    if ch = '%' and i + 2 <= n and substr(p_input, i + 1, 2) ~ '^[0-9A-Fa-f]{2}$' then
      v_bytes := v_bytes || decode(substr(p_input, i + 1, 2), 'hex');
      i := i + 3;
    else
      v_bytes := v_bytes || convert_to(ch, 'UTF8');
      i := i + 1;
    end if;
  end loop;
  return convert_from(v_bytes, 'UTF8');
exception when others then
  return null;
end;
$$;

-- Task-form attachments
insert into public.project_files
  (project_id, folder_id, task_id, bucket, storage_path, name, size_bytes, mime_type, uploaded_by, source, created_at)
select t.project_id, null, t.id, 'task-attachments', p.path,
       coalesce(nullif(trim(a->>'name'), ''), p.path),
       case when a->>'size' ~ '^\d+$' then (a->>'size')::bigint end,
       nullif(a->>'type', ''),
       t.creator_id, 'import', t.created_at
from public.project_tasks t
cross join lateral jsonb_array_elements(
  case when jsonb_typeof(t.attachments) = 'array' then t.attachments else '[]'::jsonb end) a
cross join lateral (
  select public.url_decode(substring(a->>'url' from '/object/sign/task-attachments/([^?]+)')) as path) p
where p.path is not null
  and exists (select 1 from storage.objects o
              where o.bucket_id = 'task-attachments' and o.name = p.path)
on conflict (bucket, storage_path) do nothing;

-- Comment attachments
insert into public.project_files
  (project_id, folder_id, task_id, bucket, storage_path, name, size_bytes, mime_type, uploaded_by, source, created_at)
select t.project_id, null, t.id, 'task-attachments', p.path,
       coalesce(nullif(trim(a->>'name'), ''), p.path),
       case when a->>'size' ~ '^\d+$' then (a->>'size')::bigint end,
       nullif(a->>'type', ''),
       c.user_id, 'import', c.created_at
from public.project_task_comments c
join public.project_tasks t on t.id = c.project_task_id
cross join lateral jsonb_array_elements(
  case when jsonb_typeof(c.attachments) = 'array' then c.attachments else '[]'::jsonb end) a
cross join lateral (
  select public.url_decode(substring(a->>'url' from '/object/sign/task-attachments/([^?]+)')) as path) p
where p.path is not null
  and exists (select 1 from storage.objects o
              where o.bucket_id = 'task-attachments' and o.name = p.path)
on conflict (bucket, storage_path) do nothing;
```

Check the column types before finalising: `grep -n "attachments" supabase/migrations/055_projects_feature.sql` — `project_tasks.attachments` is `jsonb not null default '[]'`, `project_task_comments.attachments` is `jsonb` (nullable). If either is not jsonb, adapt the `jsonb_typeof` guard and say so in the report.

- [ ] **Step 3: GREEN + full suite** — focused test passes; `corepack pnpm tsc --noEmit`; `corepack pnpm vitest run`.

- [ ] **Step 4: Commit** — `git commit -m "feat: import existing project attachments into project files"`

---

### Task 3: `projectFiles.ts` — types and logic

**Files:**
- Modify: `src/types/index.ts`
- Create: `src/features/projects/files/projectFiles.ts`
- Create: `src/features/projects/files/__tests__/projectFiles.test.ts`

**Interfaces:**
- Produces (all exported from `projectFiles.ts`):
  - `type FileView = { kind: 'common' } | { kind: 'task'; taskId: string } | { kind: 'folder'; folderId: string }`
  - `interface FolderNode { key: string; label: string; view: FileView; folderId: string | null; taskId: string | null; children: FolderNode[] }`
  - `buildFolderTree(tasks: Array<{ id: string; title: string }>, folders: ProjectFolder[]): FolderNode[]` — first node key `'common'`, then one node per task (key `task:<id>`, label `Task: <title>`, `folderId` = root row id or null), children = non-root folders whose `parent_id` = that root (recursively; key = folder id).
  - `findPath(tree: FolderNode[], key: string): FolderNode[]` — root-to-node list, `[]` if not found.
  - `viewFromParam(param: string | null): FileView` / `paramFromView(v: FileView): string` — `'common'`, `task:<id>`, otherwise folder id; null → common.
  - `filesForView(files: ProjectFile[], view: FileView, search?: string): ProjectFile[]` — common: all; task: `task_id === taskId && folder_id === null`; folder: `folder_id === folderId`; optional case-insensitive name filter; newest first.
  - `legacyPathFromUrl(url: string): { bucket: 'task-attachments'; path: string } | null`
  - `resolveAttachment(a: StoredAttachment): { bucket: ProjectFile['bucket']; path: string } | null`
  - `signedUrl(bucket: ProjectFile['bucket'], path: string): Promise<string | null>` — 300 s.
  - `uploadProjectFile(opts: { projectId: string; taskId: string | null; folderId: string | null; source: 'folder' | 'task' | 'comment'; file: File; userId: string }): Promise<{ file: ProjectFile; error: null } | { file: null; error: string }>`
  - `deleteProjectFile(f: ProjectFile): Promise<string | null>` — error message or null.
- Types added to `src/types/index.ts`:

```ts
export interface ProjectFolder {
  id: string
  project_id: string
  task_id: string | null
  parent_id: string | null
  name: string
  is_task_root: boolean
  created_by: string | null
  created_at: string
}

export interface ProjectFile {
  id: string
  project_id: string
  folder_id: string | null
  task_id: string | null
  bucket: 'project-files' | 'task-attachments'
  storage_path: string
  name: string
  size_bytes: number | null
  mime_type: string | null
  uploaded_by: string | null
  source: 'folder' | 'task' | 'comment' | 'import'
  created_at: string
}

// Attachments on project tasks/comments. New entries carry bucket+path and
// are signed on demand; legacy entries only have a (possibly expired) url.
export interface StoredAttachment {
  bucket?: 'project-files' | 'task-attachments'
  path?: string
  url?: string
  name: string
  size: number
  type: string
}
```
Change `ProjectTask['attachments']` to `StoredAttachment[]`.

- [ ] **Step 1: Write failing tests**

```ts
// src/features/projects/files/__tests__/projectFiles.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ProjectFile, ProjectFolder } from '@/types'

const uploadMock = vi.fn()
const removeMock = vi.fn()
const signMock = vi.fn()
const insertMock = vi.fn()
const deleteEqMock = vi.fn()
vi.mock('@/lib/supabase', () => ({
  supabase: {
    storage: { from: () => ({ upload: uploadMock, remove: removeMock, createSignedUrl: signMock }) },
    from: () => ({ insert: insertMock, delete: () => ({ eq: deleteEqMock }) }),
  },
}))

import {
  buildFolderTree, findPath, filesForView, legacyPathFromUrl, resolveAttachment,
  viewFromParam, paramFromView, uploadProjectFile, deleteProjectFile, signedUrl,
} from '../projectFiles'

const folder = (o: Partial<ProjectFolder>): ProjectFolder => ({
  id: 'f', project_id: 'p1', task_id: 't1', parent_id: null, name: 'x', is_task_root: false,
  created_by: null, created_at: '2026-10-01T00:00:00Z', ...o,
})
const file = (o: Partial<ProjectFile>): ProjectFile => ({
  id: 'x', project_id: 'p1', folder_id: null, task_id: null, bucket: 'project-files', storage_path: 'p1/x/a.pdf',
  name: 'a.pdf', size_bytes: 1, mime_type: null, uploaded_by: 'u1', source: 'folder', created_at: '2026-10-01T00:00:00Z', ...o,
})

describe('folder tree', () => {
  const tasks = [{ id: 't1', title: 'Setup' }, { id: 't2', title: 'Backlinks' }]
  const folders = [
    folder({ id: 'root1', is_task_root: true, name: 'task-root' }),
    folder({ id: 'contracts', parent_id: 'root1', name: 'Contracts' }),
    folder({ id: 'signed', parent_id: 'contracts', name: 'Signed' }),
  ]

  it('puts Common first, then a folder per task with nested sub-folders', () => {
    const tree = buildFolderTree(tasks, folders)
    expect(tree.map(n => n.label)).toEqual(['Common', 'Task: Setup', 'Task: Backlinks'])
    expect(tree[1].folderId).toBe('root1')
    expect(tree[1].children[0].label).toBe('Contracts')
    expect(tree[1].children[0].children[0].label).toBe('Signed')
    expect(tree[2].folderId).toBeNull()
  })

  it('finds the breadcrumb path to a nested folder', () => {
    const tree = buildFolderTree(tasks, folders)
    expect(findPath(tree, 'signed').map(n => n.label)).toEqual(['Task: Setup', 'Contracts', 'Signed'])
    expect(findPath(tree, 'missing')).toEqual([])
  })

  it('round-trips URL params', () => {
    for (const v of [{ kind: 'common' }, { kind: 'task', taskId: 't1' }, { kind: 'folder', folderId: 'f9' }] as const) {
      expect(viewFromParam(paramFromView(v))).toEqual(v)
    }
    expect(viewFromParam(null)).toEqual({ kind: 'common' })
  })
})

describe('filesForView', () => {
  const files = [
    file({ id: 'a', task_id: 't1', created_at: '2026-10-01T00:00:00Z', name: 'Brief.pdf' }),
    file({ id: 'b', task_id: 't1', folder_id: 'contracts', created_at: '2026-10-03T00:00:00Z' }),
    file({ id: 'c', created_at: '2026-10-02T00:00:00Z', name: 'logo.png' }),
  ]
  it('Common lists every file newest first', () => {
    expect(filesForView(files, { kind: 'common' }).map(f => f.id)).toEqual(['b', 'c', 'a'])
  })
  it('task view lists only files directly in that task', () => {
    expect(filesForView(files, { kind: 'task', taskId: 't1' }).map(f => f.id)).toEqual(['a'])
  })
  it('folder view lists that folder; search is case-insensitive', () => {
    expect(filesForView(files, { kind: 'folder', folderId: 'contracts' }).map(f => f.id)).toEqual(['b'])
    expect(filesForView(files, { kind: 'common' }, 'BRIEF').map(f => f.id)).toEqual(['a'])
  })
})

describe('legacy attachment links', () => {
  const base = 'https://mllrjejqyddgaxxtjsqf.supabase.co/storage/v1/object/sign/task-attachments/'
  it('extracts and decodes the object path, even from an expired link', () => {
    expect(legacyPathFromUrl(`${base}t1/1700-My%20Report%20%C3%A9.pdf?token=expired`))
      .toEqual({ bucket: 'task-attachments', path: 't1/1700-My Report é.pdf' })
  })
  it('returns null for foreign or malformed URLs', () => {
    expect(legacyPathFromUrl('https://example.com/a.pdf')).toBeNull()
    expect(legacyPathFromUrl(`${base}t1/bad%E0%A4.pdf?token=x`)).toBeNull()
  })
  it('resolveAttachment prefers bucket+path, falls back to the legacy url', () => {
    expect(resolveAttachment({ bucket: 'project-files', path: 'p1/x/a.pdf', name: 'a', size: 1, type: '' }))
      .toEqual({ bucket: 'project-files', path: 'p1/x/a.pdf' })
    expect(resolveAttachment({ url: `${base}t1/a.pdf?token=x`, name: 'a', size: 1, type: '' }))
      .toEqual({ bucket: 'task-attachments', path: 't1/a.pdf' })
    expect(resolveAttachment({ name: 'a', size: 1, type: '' })).toBeNull()
  })
})

describe('upload, sign and delete', () => {
  beforeEach(() => {
    uploadMock.mockReset(); removeMock.mockReset(); signMock.mockReset(); insertMock.mockReset(); deleteEqMock.mockReset()
  })
  const f = new File(['hello'], 'My Report.pdf', { type: 'application/pdf' })

  it('uploads to <project>/<fileId>/<name> then inserts the row', async () => {
    uploadMock.mockResolvedValue({ error: null })
    insertMock.mockResolvedValue({ error: null })
    const res = await uploadProjectFile({ projectId: 'p1', taskId: 't1', folderId: null, source: 'comment', file: f, userId: 'u1' })
    expect(res.error).toBeNull()
    const path = uploadMock.mock.calls[0][0] as string
    expect(path).toMatch(/^p1\/[0-9a-f-]{36}\/My Report\.pdf$/)
    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({
      project_id: 'p1', task_id: 't1', folder_id: null, bucket: 'project-files', storage_path: path,
      name: 'My Report.pdf', size_bytes: 5, mime_type: 'application/pdf', uploaded_by: 'u1', source: 'comment',
    }))
  })

  it('removes the uploaded object when the row insert fails', async () => {
    uploadMock.mockResolvedValue({ error: null })
    insertMock.mockResolvedValue({ error: { message: 'row-level security' } })
    removeMock.mockResolvedValue({ error: null })
    const res = await uploadProjectFile({ projectId: 'p1', taskId: null, folderId: null, source: 'folder', file: f, userId: 'u1' })
    expect(res.error).toMatch(/row-level security/)
    expect(removeMock).toHaveBeenCalledWith([uploadMock.mock.calls[0][0]])
  })

  it('reports an upload error without inserting', async () => {
    uploadMock.mockResolvedValue({ error: { message: 'too large' } })
    const res = await uploadProjectFile({ projectId: 'p1', taskId: null, folderId: null, source: 'folder', file: f, userId: 'u1' })
    expect(res.error).toMatch(/too large/)
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('signs for 300 seconds', async () => {
    signMock.mockResolvedValue({ data: { signedUrl: 'https://signed' }, error: null })
    expect(await signedUrl('project-files', 'p1/x/a.pdf')).toBe('https://signed')
    expect(signMock).toHaveBeenCalledWith('p1/x/a.pdf', 300)
  })

  it('deletes the object before the row; imported files delete only the row', async () => {
    removeMock.mockResolvedValue({ error: null })
    deleteEqMock.mockResolvedValue({ error: null })
    expect(await deleteProjectFile(file({ id: 'a' }))).toBeNull()
    expect(removeMock).toHaveBeenCalledWith(['p1/x/a.pdf'])
    removeMock.mockClear()
    expect(await deleteProjectFile(file({ id: 'b', bucket: 'task-attachments', source: 'import' }))).toBeNull()
    expect(removeMock).not.toHaveBeenCalled()
    expect(deleteEqMock).toHaveBeenLastCalledWith('id', 'b')
  })
})
```
Run → FAIL (module missing).

- [ ] **Step 2: Implement**

```ts
// src/features/projects/files/projectFiles.ts
// Project Files (spec 2026-10-05-project-files-design.md): upload/sign/delete,
// legacy attachment links, and the folder tree shown on the Files tab.
import { supabase } from '@/lib/supabase'
import type { ProjectFile, ProjectFolder, StoredAttachment } from '@/types'

export const PROJECT_FILES_BUCKET = 'project-files'
const SIGNED_URL_SECONDS = 300
const LEGACY_PATH_RE = /\/storage\/v1\/object\/sign\/task-attachments\/([^?#]+)/

export type FileView = { kind: 'common' } | { kind: 'task'; taskId: string } | { kind: 'folder'; folderId: string }

export interface FolderNode {
  key: string
  label: string
  view: FileView
  folderId: string | null
  taskId: string | null
  children: FolderNode[]
}

function childrenOf(parentId: string, folders: ProjectFolder[], taskId: string | null): FolderNode[] {
  return folders
    .filter(f => !f.is_task_root && f.parent_id === parentId)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(f => ({
      key: f.id, label: f.name, view: { kind: 'folder', folderId: f.id }, folderId: f.id, taskId,
      children: childrenOf(f.id, folders, taskId),
    }))
}

export function buildFolderTree(tasks: Array<{ id: string; title: string }>, folders: ProjectFolder[]): FolderNode[] {
  const common: FolderNode = { key: 'common', label: 'Common', view: { kind: 'common' }, folderId: null, taskId: null, children: [] }
  const taskNodes = tasks.map(t => {
    const root = folders.find(f => f.is_task_root && f.task_id === t.id)
    return {
      key: `task:${t.id}`, label: `Task: ${t.title}`, view: { kind: 'task', taskId: t.id } as FileView,
      folderId: root?.id ?? null, taskId: t.id,
      children: root ? childrenOf(root.id, folders, t.id) : [],
    }
  })
  return [common, ...taskNodes]
}

export function findPath(tree: FolderNode[], key: string): FolderNode[] {
  for (const node of tree) {
    if (node.key === key) return [node]
    const sub = findPath(node.children, key)
    if (sub.length) return [node, ...sub]
  }
  return []
}

export function viewFromParam(param: string | null): FileView {
  if (!param || param === 'common') return { kind: 'common' }
  if (param.startsWith('task:')) return { kind: 'task', taskId: param.slice(5) }
  return { kind: 'folder', folderId: param }
}

export function paramFromView(v: FileView): string {
  return v.kind === 'common' ? 'common' : v.kind === 'task' ? `task:${v.taskId}` : v.folderId
}

export function filesForView(files: ProjectFile[], view: FileView, search = ''): ProjectFile[] {
  const q = search.trim().toLowerCase()
  return files
    .filter(f => view.kind === 'common'
      || (view.kind === 'task' && f.task_id === view.taskId && f.folder_id === null)
      || (view.kind === 'folder' && f.folder_id === view.folderId))
    .filter(f => !q || f.name.toLowerCase().includes(q))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
}

export function legacyPathFromUrl(url: string): { bucket: 'task-attachments'; path: string } | null {
  const m = url.match(LEGACY_PATH_RE)
  if (!m) return null
  try {
    return { bucket: 'task-attachments', path: decodeURIComponent(m[1]) }
  } catch {
    return null
  }
}

export function resolveAttachment(a: StoredAttachment): { bucket: ProjectFile['bucket']; path: string } | null {
  if (a.bucket && a.path) return { bucket: a.bucket, path: a.path }
  return a.url ? legacyPathFromUrl(a.url) : null
}

export async function signedUrl(bucket: ProjectFile['bucket'], path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, SIGNED_URL_SECONDS)
  return error || !data?.signedUrl ? null : data.signedUrl
}

export async function uploadProjectFile(opts: {
  projectId: string; taskId: string | null; folderId: string | null
  source: 'folder' | 'task' | 'comment'; file: File; userId: string
}): Promise<{ file: ProjectFile; error: null } | { file: null; error: string }> {
  const id = crypto.randomUUID()
  const path = `${opts.projectId}/${id}/${opts.file.name}`
  const { error: upErr } = await supabase.storage.from(PROJECT_FILES_BUCKET)
    .upload(path, opts.file, { contentType: opts.file.type || undefined })
  if (upErr) return { file: null, error: `Upload failed for ${opts.file.name}: ${upErr.message}` }

  const row: ProjectFile = {
    id, project_id: opts.projectId, folder_id: opts.folderId, task_id: opts.taskId,
    bucket: PROJECT_FILES_BUCKET, storage_path: path, name: opts.file.name,
    size_bytes: opts.file.size, mime_type: opts.file.type || null, uploaded_by: opts.userId,
    source: opts.source, created_at: new Date().toISOString(),
  }
  const { created_at: _createdAt, ...insertRow } = row
  const { error: rowErr } = await supabase.from('project_files').insert(insertRow)
  if (rowErr) {
    await supabase.storage.from(PROJECT_FILES_BUCKET).remove([path])
    return { file: null, error: `Could not save ${opts.file.name}: ${rowErr.message}` }
  }
  return { file: row, error: null }
}

export async function deleteProjectFile(f: ProjectFile): Promise<string | null> {
  if (f.bucket === PROJECT_FILES_BUCKET) {
    const { error } = await supabase.storage.from(PROJECT_FILES_BUCKET).remove([f.storage_path])
    if (error) return `Could not delete ${f.name}: ${error.message}`
  }
  const { error } = await supabase.from('project_files').delete().eq('id', f.id)
  return error ? `Could not delete ${f.name}: ${error.message}` : null
}
```
(If ESLint/TS flags the unused `_createdAt`, keep the destructure — `created_at` is set by the DB default — or build `insertRow` explicitly.)

- [ ] **Step 3: GREEN** — focused tests pass; fix any `tsc` errors caused by the `ProjectTask['attachments']` type change (callers that read `a.url` must handle optional `url`; Task 4 replaces those renderers, so a minimal `a.url ?? ''` is acceptable here). Full suite passes.

- [ ] **Step 4: Commit** — `git commit -m "feat: add project files library (upload, sign, legacy links, folder tree)"`

---

### Task 4: AttachmentLink and task/comment uploads via project files

**Files:**
- Create: `src/features/projects/files/AttachmentLink.tsx`
- Create: `src/features/projects/files/__tests__/AttachmentLink.test.tsx`
- Modify: `src/features/projects/ProjectTaskDetailModal.tsx` (remove local `FileChip`; comment uploads; render `AttachmentLink`)
- Modify: `src/features/projects/CreateProjectTaskModal.tsx` (`uploadAttachments`)

**Interfaces:**
- Consumes: `resolveAttachment`, `signedUrl`, `uploadProjectFile` (Task 3).
- Produces: `<AttachmentLink attachment: StoredAttachment />`.

- [ ] **Step 1: Failing tests**

```tsx
// src/features/projects/files/__tests__/AttachmentLink.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const signedUrlMock = vi.fn()
vi.mock('@/lib/supabase', () => ({ supabase: {} }))
vi.mock('../projectFiles', async (orig) => ({
  ...(await orig<typeof import('../projectFiles')>()),
  signedUrl: (...a: unknown[]) => signedUrlMock(...a),
}))

import { AttachmentLink } from '../AttachmentLink'

describe('AttachmentLink', () => {
  beforeEach(() => { signedUrlMock.mockReset(); vi.spyOn(window, 'open').mockImplementation(() => null) })

  it('signs bucket+path fresh on click and opens it', async () => {
    signedUrlMock.mockResolvedValue('https://fresh')
    render(<AttachmentLink attachment={{ bucket: 'project-files', path: 'p1/x/a.pdf', name: 'a.pdf', size: 1, type: '' }} />)
    await userEvent.click(screen.getByRole('button', { name: /a\.pdf/ }))
    expect(signedUrlMock).toHaveBeenCalledWith('project-files', 'p1/x/a.pdf')
    expect(window.open).toHaveBeenCalledWith('https://fresh', '_blank', 'noopener')
  })

  it('re-signs a legacy expired link from its path', async () => {
    signedUrlMock.mockResolvedValue('https://fresh2')
    const url = 'https://x.supabase.co/storage/v1/object/sign/task-attachments/t1/old.pdf?token=expired'
    render(<AttachmentLink attachment={{ url, name: 'old.pdf', size: 1, type: '' }} />)
    await userEvent.click(screen.getByRole('button', { name: /old\.pdf/ }))
    expect(signedUrlMock).toHaveBeenCalledWith('task-attachments', 't1/old.pdf')
  })

  it('shows an error when the file cannot be opened', async () => {
    signedUrlMock.mockResolvedValue(null)
    render(<AttachmentLink attachment={{ bucket: 'project-files', path: 'p1/x/gone.pdf', name: 'gone.pdf', size: 1, type: '' }} />)
    await userEvent.click(screen.getByRole('button', { name: /gone\.pdf/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not open/i)
  })
})
```
Run → FAIL.

- [ ] **Step 2: Implement AttachmentLink**

```tsx
// src/features/projects/files/AttachmentLink.tsx
import { useState } from 'react'
import type { StoredAttachment } from '@/types'
import { resolveAttachment, signedUrl } from './projectFiles'

const IMAGE_RE = /\.(jpg|jpeg|png|gif|webp)$/i

// Opens a project attachment through a freshly signed URL, so links never
// expire (stored 30-day URLs did). Legacy entries are re-signed from the
// path embedded in their old URL.
export function AttachmentLink({ attachment }: { attachment: StoredAttachment }) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const target = resolveAttachment(attachment)

  async function open() {
    if (!target) return
    setBusy(true)
    setFailed(false)
    const url = await signedUrl(target.bucket, target.path)
    setBusy(false)
    if (!url) { setFailed(true); return }
    window.open(url, '_blank', 'noopener')
  }

  const icon = IMAGE_RE.test(attachment.name) || attachment.type.startsWith('image/') ? '🖼' : '📄'
  return (
    <span className="inline-flex flex-col">
      <button type="button" onClick={() => void open()} disabled={busy || !target}
        className="flex items-center gap-1.5 bg-gray-100 rounded-lg px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500 disabled:opacity-60 max-w-[180px]">
        <span aria-hidden="true">{icon}</span> <span className="truncate">{attachment.name}</span>
      </button>
      {failed && <span role="alert" className="text-[11px] text-red-600 mt-0.5">Could not open this file.</span>}
    </span>
  )
}
```

- [ ] **Step 3: Switch the modals**

`ProjectTaskDetailModal.tsx`:
- Delete the local `FileChip` function; import `AttachmentLink` and `uploadProjectFile`.
- Task attachments: `{task.attachments.map((a, i) => <AttachmentLink key={i} attachment={a} />)}`.
- Comment attachments: cast `atts` to `StoredAttachment[]` and render `AttachmentLink` the same way.
- In `postComment`, replace the per-file `task-attachments` upload + `createSignedUrl` loop with:

```ts
    const attachments: StoredAttachment[] = []
    for (const f of commentFiles) {
      const res = await uploadProjectFile({ projectId: task.project_id, taskId: task.id, folderId: null, source: 'comment', file: f, userId: user.id })
      if (res.error) { setActionError(res.error); continue }
      attachments.push({ bucket: res.file.bucket, path: res.file.storage_path, name: f.name, size: f.size, type: f.type })
    }
```

`CreateProjectTaskModal.tsx` `uploadAttachments(taskId)`: keep its signature and the existing-attachments seed, and replace the loop body with `uploadProjectFile({ projectId, taskId, folderId: null, source: 'task', file: a.file, userId: user!.id })`, pushing `{ bucket, path: storage_path, name, size, type }` on success and calling `setError(res.error)` on failure (continue with the rest).

Existing `ProjectTaskDetailModal` tests (e.g. `ProjectTaskDetailModal.associate.test.tsx`) mock supabase — extend their mocks only if the new import path requires it; do not weaken assertions.

- [ ] **Step 4: GREEN** — focused tests pass; `corepack pnpm tsc --noEmit`; full suite passes.

- [ ] **Step 5: Commit** — `git commit -m "feat: store project task/comment uploads as project files with fresh links"`

---

### Task 5: Files tab UI and ProjectPage tabs

**Files:**
- Create: `src/features/projects/files/ProjectFilesTab.tsx`
- Create: `src/features/projects/files/__tests__/ProjectFilesTab.test.tsx`
- Modify: `src/features/projects/ProjectPage.tsx`

**Interfaces:**
- Consumes: everything from Task 3; `useAuth()`; members `User[]` (real roles) from ProjectPage.
- Produces: `<ProjectFilesTab projectId: string tasks: Array<{ id: string; title: string }> members: User[] />`.

Behaviour (from spec §2.1):
- Loads `project_folders` and `project_files` for the project (`.eq('project_id', projectId)`); shows load errors.
- Current view from `useSearchParams().get('folder')` via `viewFromParam`; selecting a tree node sets `folder` (keep `tab=files`).
- Layout: tree `<nav aria-label="Folders">` left (`md:w-64`), stacked above on mobile; main panel with breadcrumbs (`findPath`), toolbar, search box (Common only), file table/list.
- **Upload** button (`<input type="file" multiple>` + drag-and-drop onto the panel). Target: Common → `taskId null, folderId null`; task view → `taskId, folderId null`; folder view → that folder's `folderId` and its node's `taskId`. `source: 'folder'`. Show per-file errors; append successes.
- **New folder** (only when role ∈ Admin/Manager/Super-Admin and view is task or folder): prompt for a name (inline input); in task view call `supabase.rpc('ensure_task_root_folder', { p_task_id })` for the parent; insert `{ project_id, task_id, parent_id, name, created_by: user.id }`. Map unique-violation (`23505`) to "A folder with that name already exists here."
- Folder **Rename/Delete** (same roles, sub-folders only): delete errors with code `23503` → "Folder must be empty before it can be deleted."
- File row: icon, name, size (KB/MB), uploader name (from `members`, else "—"), date, source badge (Folder/Task/Comment/Imported). **Download** for all (`signedUrl` → `window.open`). **Rename / Move / Delete** when `canManage || f.uploaded_by === user.id`. Move = select of folders in the same task (task root option = `folder_id null`), updating `folder_id` and keeping `task_id`. Delete confirms with `window.confirm`, calls `deleteProjectFile`.
- All buttons ≥ 44 px tall on touch, visible `focus-visible` rings, no horizontal page scroll at 320 px (file rows wrap metadata under the name on mobile).

- [ ] **Step 1: Failing tests** — create `ProjectFilesTab.test.tsx` that mocks `@/lib/supabase` (`from('project_folders'|'project_files')` → `select().eq()` resolving fixture data; `rpc`; `storage`) and `@/hooks/useAuth`, renders inside `MemoryRouter initialEntries={['/projects/p1?tab=files']}`, and asserts:
  1. Tree shows `Common`, `Task: Setup`, and a sub-folder `Contracts`; Common lists all fixture files.
  2. Clicking `Task: Setup` lists only that task's root files.
  3. As **Associate**: no "New folder" button; Upload button present; no Delete on another user's file; Delete present on own file.
  4. As **Manager** in a task view: "New folder" creates via `rpc('ensure_task_root_folder', { p_task_id: 't1' })` then inserts with that `parent_id`.
  5. Deleting a non-empty folder whose delete returns `{ error: { code: '23503' } }` shows "Folder must be empty before it can be deleted."
  Run → FAIL.

- [ ] **Step 2: Implement `ProjectFilesTab.tsx`** per the behaviour list (aim ≤ 350 lines; if it grows past that, split a `FileRow` component into `FileRow.tsx` in the same folder).

- [ ] **Step 3: ProjectPage tabs** — in `ProjectPage.tsx`: `const [params, setParams] = useSearchParams(); const tab = params.get('tab') === 'files' ? 'files' : 'tasks'`. Above the page header render a `role="tablist"` with two `role="tab"` buttons (`aria-selected`), Tasks and Files, switching `tab` (Files sets `tab=files&folder=common`; Tasks removes both). When `tab === 'files'` render `<ProjectFilesTab projectId={projectId!} tasks={rows.map(r => ({ id: r.task.id, title: r.task.title }))} members={members} />` instead of the task board (keep presence header visible in both). Change the page header title from "Tasks" to the active tab label.

- [ ] **Step 4: GREEN** — focused tests pass; `corepack pnpm tsc --noEmit`; full suite passes.

- [ ] **Step 5: Commit** — `git commit -m "feat: add project Files tab with folders, uploads, and Common view"`

---

### Task 6: Deploy and live verification (controller)

Run by the controller (needs the Supabase token and pushes to main, which the user authorised with "deploy").

- [ ] Merge `feat/project-files` into `main` (fast-forward), run the full suite on main, push, watch the GitHub Actions Deploy run until both jobs succeed.
- [ ] Via Management API: confirm migrations `20261006000600` and `20261006000700` applied; bucket `project-files` exists, private, 52428800 limit; both tables have RLS on; `associate_request_guard` contains `project_files`; import count = number of attachment entries whose objects exist (report both numbers).
- [ ] Storage isolation: as `postgres` via the API, `set local role authenticated; set local request.jwt.claims = '{"email":"<a user not in AMUSA>","role":"authenticated"}'` and `select count(*) from storage.objects where bucket_id='project-files'` → 0 rows visible; same for a member → visible.
- [ ] Report results and anything the user must check in the browser (upload a file in AMUSA → Files, open an old attachment).
