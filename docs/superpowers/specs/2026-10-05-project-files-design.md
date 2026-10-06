# Project Files & Folders — Design

**Date:** 2026-10-05
**Status:** Approved in conversation; awaiting written-spec review
**Builds on:** [2026-09-21-projects-feature-design.md](2026-09-21-projects-feature-design.md), [2026-10-05-project-associates-design.md](2026-10-05-project-associates-design.md)

## Goal

Give every Project a **Files** area. Admins and Managers can create folders
under each task to organise documents, and **every file any member uploads
in the project** — into a folder, on the task form, or on a comment — is
also listed in a project-wide **Common** folder.

## Decisions (from brainstorming)

| Question | Decision |
|---|---|
| Structure | One **Files** tab per project: a **Common** folder (all project files, automatically) plus one folder per task; Admin/Manager create sub-folders inside task folders. Common is a view of the same files, never copies. |
| Permissions | Any project member (incl. associates) uploads into any folder and downloads everything. Folder create/rename/delete: Admin, Manager, Super-Admin members. Rename/move/delete a file: its uploader, or Admin/Manager/Super-Admin. |
| Existing attachments | Imported once into the Files area, and attachment chips switch to fresh signed links (fixes the existing 30-day expiry). |
| Architecture | Approach A: `project_folders` + `project_files` tables, new private project-scoped bucket. |

## Problems in today's code this design fixes

1. **Attachment links expire.** `CreateProjectTaskModal` and
   `ProjectTaskDetailModal` store 30-day signed URLs in
   `project_tasks.attachments` / `project_task_comments.attachments`.
   Anything older than 30 days is a dead link.
2. **Project files aren't project-private.** The `task-attachments` bucket
   policies (005) only check `auth.role() = 'authenticated'`, so any signed-in
   DigiTracker user can read them. (Associates are already narrowed by
   `storage_associate_scope`.) The new bucket is member-only from day one;
   tightening `task-attachments` itself is out of scope (it is shared with the
   workspace Tasks feature) — new uploads go to the new bucket instead.

## 1. Data and security

### 1.1 Tables

```sql
project_folders (
  id          uuid pk default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  task_id     uuid references project_tasks(id) on delete cascade,  -- null only for project-level folders
  parent_id   uuid references project_folders(id) on delete restrict,
  name        text not null check (length(trim(name)) between 1 and 100),
  is_task_root boolean not null default false,  -- the auto-created "Task: <title>" folder
  created_by  uuid references users(id) on delete set null,
  created_at  timestamptz not null default now()
)
unique (project_id, coalesce(parent_id, '0…0'::uuid), lower(name))  -- via unique index
unique (task_id) where is_task_root                                  -- one root per task

project_files (
  id           uuid pk default gen_random_uuid(),
  project_id   uuid not null references projects(id) on delete cascade,
  folder_id    uuid references project_folders(id) on delete restrict,
  task_id      uuid references project_tasks(id) on delete set null,
  bucket       text not null check (bucket in ('project-files', 'task-attachments')),
  storage_path text not null,
  name         text not null,
  size_bytes   bigint,
  mime_type    text,
  uploaded_by  uuid references users(id) on delete set null,
  source       text not null check (source in ('folder', 'task', 'comment', 'import')),
  created_at   timestamptz not null default now(),
  unique (bucket, storage_path)
)
```

- **Common** = `select … from project_files where project_id = $1`.
- **A task's folder (root view)** = files with `task_id = <task>` and
  `folder_id is null` — task-form attachments, comment attachments, and files
  uploaded directly into the task folder — plus that task's sub-folders.
- **A sub-folder** = files with `folder_id = <that folder>`. Files uploaded
  into a sub-folder also carry the sub-folder's `task_id`, so they still
  appear in Common and can be traced to their task.
- Every task appears as a folder in the tree without needing a row. A
  `project_folders` row with `is_task_root = true` exists only to be the
  parent of that task's sub-folders; it is created on first sub-folder
  creation by the RPC `ensure_task_root_folder(p_task_id) returns uuid`
  (security definer; caller must be an Admin/Manager/Super-Admin member).
  The tree always labels a task folder `Task: <current task title>`; the
  stored `name` of a root row is not displayed.
- `on delete restrict` on folder references makes "folder must be empty to
  delete" a database rule, not just UI.

### 1.2 Storage

- New private bucket `project-files`, 50 MB file limit, any MIME type.
- Object path: `<project_id>/<file_id>/<original file name>`.
- `storage.objects` policies for `bucket_id = 'project-files'`:
  - select / insert: `is_project_member(((storage.foldername(name))[1])::uuid)`.
  - delete: member **and** (the matching `project_files.uploaded_by` is the
    caller, or the caller's role is Admin/Manager/Super-Admin).
- The associate storage lock (`storage_associate_scope`, 20261006000100) is
  extended in a new migration so associates may also reach
  `project-files` objects of projects they belong to.

### 1.3 Row-level security

| Table | select | insert | update | delete |
|---|---|---|---|---|
| project_folders | member | member AND role in (Admin, Manager, Super-Admin) — except `is_task_root` rows, which only the RPC creates | same as insert | same as insert |
| project_files | member | member AND `uploaded_by = auth_user_app_id()` | uploader OR role in (Admin, Manager, Super-Admin), member | same as update |

"member" = `is_project_member(project_id)`. Roles come from
`auth_user_role()`. Associates are never Admin/Manager, so they can upload,
and rename/move/delete only their own files.

Both tables are project tables, so they join the associate allow-lists:
`PROJECT_TABLES` in `src/__tests__/associateLock.test.ts`, the
`associate_request_guard` table regex, and the blanket-deny exclusion list in
`associate_lock_gaps()` — all updated in the new migration (redefining the
two functions) rather than by editing applied migrations.

### 1.4 Deletion

Deleting a file deletes the `project_files` row and the storage object (the
client removes the object first, then the row; a failed object delete leaves
the row so nothing is orphaned silently). Imported rows in the
`task-attachments` bucket delete only the row (the object may still be
referenced by the task/comment's attachments JSON).

## 2. Files tab and upload flow

### 2.1 UI

- ProjectPage gets tabs **Tasks | Files** (URL: `/projects/:id?tab=files`,
  plus `&folder=<id|common|task:<taskId>>` so views are shareable).
- **Folder tree** (left on desktop, collapsible list above on mobile):
  📁 Common, then 📁 `Task: <title>` per task (all tasks, not only those with
  files), expandable to sub-folders.
- **Toolbar:** breadcrumbs; **Upload** (file picker + drag-and-drop, multiple
  files, per-file progress/error); **New folder** (Admin/Manager/Super-Admin,
  inside task folders and their sub-folders only).
- **File list:** icon by type, name, size, uploader, date, source badge
  (Folder / Task / Comment / Imported); actions **Download** (fresh 5-minute
  signed URL), and **Rename / Move / Delete** when permitted.
- **Common:** all project files newest first, with a name search box.
  Uploading while in Common creates a project-level file (no task, no folder).

### 2.2 Other upload paths

- `CreateProjectTaskModal` and `ProjectTaskDetailModal` upload new files to
  `project-files` (not `task-attachments`) and insert a `project_files` row
  (`source` = 'task' or 'comment', `task_id` set, `folder_id` null).
- The `attachments` JSON keeps its shape but stores
  `{ bucket, path, name, size, type }` for new entries (no `url`).
- A shared `<AttachmentLink>` component replaces `FileChip` usage for project
  tasks/comments: on click it creates a fresh signed URL from `bucket+path`;
  for legacy entries with only `url`, it extracts the path from the URL and
  signs it fresh (works even after the old link expired).

### 2.3 One-time import

A migration step (idempotent, `on conflict (bucket, storage_path) do nothing`)
walks `project_tasks.attachments` and `project_task_comments.attachments`,
extracts `task-attachments/<path>` from each stored signed URL, and inserts
`project_files` rows (`source` 'import', `bucket` 'task-attachments',
`task_id`, `uploaded_by` = task creator / comment author, `created_at` =
task/comment time). Entries whose object no longer exists in
`storage.objects` are skipped. Nothing is moved, copied, or deleted.

### 2.4 Notifications

Uploads do not create notifications or emails.

## 3. Testing and rollout

- **Vitest:** folder-tree building and breadcrumb paths; Common lists all
  files; task folder lists its task/comment/folder files; upload flow writes
  object then row (and surfaces a row-insert failure); New folder and
  others'-file actions hidden for Staff/Associate; legacy URL → path parser
  (valid, expired-token, foreign URL → null); `AttachmentLink` signs fresh;
  static lock test includes the two new tables and the updated guard regex.
- **Live checks after deploy (Management API + test sessions):** member
  upload/download works; a non-member workspace user cannot read a
  `project-files` object; an associate can upload but not create a folder;
  imported row count equals attachment count minus missing objects; an old
  expired attachment opens through `AttachmentLink`.
- **Rollout:** one deploy (migration creates tables, bucket, policies,
  guard/allow-list updates, and runs the import). Re-running the import is a
  no-op.

## Out of scope

- Tightening the shared `task-attachments` bucket for the workspace Tasks
  feature.
- File versioning, previews/thumbnails, folder sharing outside the project.
- Upload notifications.
- Moving files between projects.
