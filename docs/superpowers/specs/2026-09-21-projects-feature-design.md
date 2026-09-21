# Projects Feature — Design

## Summary

A new **Projects** feature: a cross-sub-account collaboration space that
mirrors the existing Tasks feature (task board, assignment, comments), but
whose membership can span up to 3 different customer workspaces
(`sub_account`s) instead of being confined to one. Provisioning a project and
managing its membership is a Super-Admin-only action. Members see a
per-project entry in their sidebar and a presence header showing every other
member's online/idle/offline status.

## Why this needs a design doc, not just a bounded change

Every existing feature in DigiTracker (Tasks, KPIs, Leave, Documents,
time-logs) is built on a single-tenant isolation model: every row belongs to
exactly one `sub_account`, and RLS policies were explicitly audited and
hardened (migration `026_manager_downline_and_isolation.sql`) to guarantee an
Admin or Manager can never see another company's data. Projects deliberately
needs the opposite for a narrow slice of data — controlled, explicit
cross-tenant visibility for specific people the Super-Admin has placed
together. Getting the boundary of that exception wrong either reopens the
class of bug migration 026 fixed, or leaks more than intended (e.g. one
company's raw time-log detail visible to another). This is why the design is
a fully separate, additive module rather than a modification of the existing
Tasks tables/policies.

## Data model

### `projects`
```sql
id          uuid primary key default gen_random_uuid()
name        text not null                    -- e.g. "JohnBakery"
created_by  uuid not null references public.users(id)
created_at  timestamptz not null default now()
```
No `sub_account` column — a project is not owned by one company.

### `project_members`
```sql
project_id  uuid not null references public.projects(id) on delete cascade
user_id     uuid not null references public.users(id) on delete cascade
added_at    timestamptz not null default now()
primary key (project_id, user_id)
```
Single source of truth for "who is in this project." Drives RLS on every
`project_*` table below and drives which sidebar entries a user sees. Only
ever written to via the `add_project_member` / `remove_project_member` RPCs
below — no direct client insert/delete policy is granted, since the 3-workspace
cap must be enforced server-side, not just in the UI.

### `project_tasks`, `project_task_assignees`, `project_task_comments`
Structurally identical to the existing `tasks` / `task_assignees` /
`task_comments` tables:
```sql
-- project_tasks
id           uuid primary key default gen_random_uuid()
project_id   uuid not null references public.projects(id) on delete cascade
title        text not null
description  text
creator_id   uuid not null references public.users(id)
assignee_id  uuid references public.users(id)
status       text not null default 'pending'
             check (status in ('pending','in_progress','completed','closed','archived'))
due_date     timestamptz
recurring    text check (recurring in ('Daily','Weekly','Monthly'))
attachments  jsonb not null default '[]'
created_at   timestamptz not null default now()

-- project_task_assignees
project_task_id  uuid not null references public.project_tasks(id) on delete cascade
user_id          uuid not null references public.users(id)
primary key (project_task_id, user_id)

-- project_task_comments
id               uuid primary key default gen_random_uuid()
project_task_id  uuid not null references public.project_tasks(id) on delete cascade
user_id          uuid not null references public.users(id)
body             text not null
attachments      jsonb
created_at       timestamptz not null default now()
```

## Security model

### `is_project_member(p_project_id uuid) returns boolean`
```sql
language sql security definer stable
as $$
  select exists (
    select 1 from public.project_members
    where project_id = p_project_id and user_id = public.auth_user_app_id()
  )
$$;
```
Every RLS policy on `project_tasks` / `project_task_assignees` /
`project_task_comments` gates on this — any member (any role, any home
sub-account) has the same read/write shape members of the existing Tasks
feature have today (create, assign, comment, see all tasks in the project).
There is no Admin/Manager-elevated bypass inside a project — membership
itself is already the elevated, explicitly-granted permission.

### `add_project_member(p_project_id uuid, p_user_id uuid) returns void`
Security definer, callable only by Super-Admin (checked inside the function,
same pattern as `archive_and_delete_user`). Before inserting into
`project_members`, counts `count(distinct u.sub_account)` across existing
members plus the candidate; raises an exception if that count would exceed 3.
This is the enforcement point for the 3-sub-account cap — not a UI-only
check, so it holds even under concurrent Super-Admin sessions.

### `remove_project_member(p_project_id uuid, p_user_id uuid) returns void`
Security definer, Super-Admin only. Plain delete from `project_members`.

### `get_project_member_status(p_project_id uuid) returns table(...)`
```sql
returns table (
  user_id          uuid,
  name             text,
  profile_image    text,
  status           text,       -- 'working' | 'lunch' | null (not currently clocked in)
  last_activity_at timestamptz
)
language sql security definer stable
as $$
  select u.id, u.name, u.profile_image, tl.status, tl.last_activity_at
  from public.project_members pm
  join public.users u on u.id = pm.user_id
  left join public.time_logs tl
    on tl.user_id = u.id
    and tl.status in ('working','lunch')   -- an active session, not a completed one
  where pm.project_id = p_project_id
    and public.is_project_member(p_project_id)  -- caller must themselves be a member
$$;
```
Deliberately no `date = today` filter: with members spanning up to 3
different sub-account timezones, "today" isn't a single boundary. An active
(not-yet-clocked-out) `time_logs` row is unambiguous regardless of which
calendar day its `date` column recorded when the session started, so
filtering on `status` alone is both simpler and more correct here than the
`date`-based filter `TeamAvatarRow.tsx` uses for its single-timezone case.

This is the only place project-member presence is ever read. It deliberately
returns only `{id, name, profile_image, status, last_activity_at}` — never
the full `time_logs` row, never anything from other tables — so a member of
Company A can see that a Company B teammate is online, but nothing else about
Company B. The client computes the final `online` / `idle` / `offline` label
using the exact same `isIdle()` helper (`lib/activity.ts`) and thresholds
`TeamAvatarRow.tsx` already uses for the existing Team Status indicator, so
Projects' presence behaves identically to what's already shipped.

## Super-Admin UI

New tab in the Super-Admin panel (`src/features/super-admin/`), alongside the
existing `SubAccountsTab` / `PlatformSettingsTab` pattern:

- **ProjectsTab.tsx** — list existing projects, "New Project" (name only,
  calls into a create RPC or plain insert — Super-Admin already bypasses
  project-scoped RLS by definition of being Super-Admin elsewhere in this
  app, so a direct insert with a `created_by = auth_user_app_id()` check is
  sufficient here, no new RPC needed for creation itself).
- Selecting a project opens a detail panel: search users **across all
  sub-accounts** (Super-Admin already has this reach via existing patterns
  in `SubAccountDetailPanel.tsx`), add/remove members via
  `add_project_member` / `remove_project_member`. The add flow surfaces the
  RPC's cap-exceeded error inline ("This project already has members from 3
  workspaces — remove one before adding a member from a 4th.").

## Sidebar navigation (`src/app/Layout.tsx`)

`STAFF_NAV` becomes partly dynamic. On mount (and on a lightweight realtime
subscription to `project_members` filtered to the caller, mirroring the
existing `layout-task-count` channel pattern), fetch the caller's project
memberships joined to `projects.name`, and append one nav entry per project:

```
{ to: `/projects/${project.id}`, end: false, label: `PROJECTS-${project.name}`, icon: '🗂' }
```

Multiple memberships produce multiple entries, each independently
highlighted/active per the existing `NavLink` logic — no grouping or
dropdown, exactly as specified. A user with zero project memberships sees no
Projects entries at all (list is simply empty, not conditionally rendered
special-cased).

## Project page (`src/features/projects/`)

New route `/projects/:projectId`, gated by an `AuthGuard`-equivalent check
(loads the project, calls `is_project_member` implicitly via RLS — an empty
result / 403-shaped state means "not a member," which redirects to `/`).

- **ProjectPage.tsx** — same shape as `TasksPage.tsx`: filter bar (All /
  Mine / Assigned / Pending / Overdue / Closed / Archived), task cards,
  `CreateProjectTaskModal`, `ProjectTaskDetailModal`. These are new
  components mirroring `CreateTaskModal` / `TaskDetailModal` structurally,
  pointed at `project_tasks` / `project_task_assignees` /
  `project_task_comments` and scoped by `projectId` instead of the caller's
  sub-account/downline.
- **Header**: avatar row of every `project_members` row for this project
  (name, avatar, presence dot), sourced from `get_project_member_status`,
  refreshed the same way `TeamAvatarRow` refreshes today (initial load +
  `useRealtime` on `time_logs` INSERT/UPDATE, scoped by re-filtering client
  side to this project's member-id set since the realtime channel itself
  can't filter by an RPC).

## What's explicitly out of scope (YAGNI)

- No project-level Calendar, KPIs, Leave, or Documents — "same features as
  Tasks" means the task board specifically, not the whole app surface.
- No self-serve project creation or membership management for regular
  Admins — Super-Admin only, per your answer.
- No notion of project archiving/deletion UI beyond what's needed to unwind
  a test project — can be added later if needed (YAGNI for v1).
- No change to any existing table's RLS. Zero risk to Tasks/KPIs/time-logs/
  documents isolation guarantees.

## Testing

- Unit tests for `add_project_member`'s 3-workspace cap logic (via a thin
  Vitest suite hitting the RPC through a mocked Supabase client, following
  the existing `UsersTab.test.tsx` mocking pattern) — cap not yet reached
  (allowed), cap reached with a *new* workspace (rejected), cap reached with
  an *existing* workspace's user (allowed, since it doesn't add a 4th).
- Component tests for the sidebar's dynamic project entries (0, 1, and 2+
  memberships) mirroring the existing `Layout` test conventions if any exist,
  else a focused new test file.
- Component tests for `ProjectPage` reusing the `TasksPage`-style test
  approach where one exists.
- No new edge function is required for this feature (all privileged logic is
  SQL-level SECURITY DEFINER RPCs, consistent with `archive_and_delete_user`
  and `check_account_status` rather than Deno functions), so no edge-function
  test gap is introduced.
