# Project Associates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Super-Admins and Admins invite outside "associates" into a Project by email; associates sign in, see only their projects, can work on tasks assigned to them, and get in-app + email notifications for project activity.

**Architecture:** Associates are ordinary `users` rows with `role='Associate'` and the sentinel `sub_account='ASSOCIATE'`. Two independent database layers keep them out of everything else: (1) a RESTRICTIVE `*_deny_associates` RLS policy on every non-project table and on `storage.objects`; (2) a PostgREST `db_pre_request` guard that rejects any table/RPC path outside a short allow-list for associates (this also covers the ~30 SECURITY DEFINER RPCs, which bypass RLS). Project activity notifications are written by database triggers; an `after insert` trigger on `notifications` calls a new `send-notification-email` edge function via `pg_net`.

**Tech Stack:** Supabase Postgres (RLS, plpgsql triggers, pg_net, Vault), Supabase Edge Functions (Deno, denomailer via `_shared/smtp.ts`), React 18 + TypeScript + react-router-dom 6 (HashRouter), Vitest + Testing Library, pnpm (run via `corepack pnpm`).

**Spec:** [docs/superpowers/specs/2026-10-05-project-associates-design.md](../specs/2026-10-05-project-associates-design.md)

**Repo:** `/Users/arunkemer/DIGI5Y/digitracker`, branch `feat/project-associates`.

## Global Constraints

- Role value is exactly `'Associate'`; associate `sub_account` is exactly `'ASSOCIATE'`; `ASSOCIATE` is a reserved sub-account code.
- New migrations MUST be timestamp-named (`2026100600xxxx_*.sql`) — never `060_…`; `supabase db push` rejects local migrations that sort before the newest remote one (`20261005000001`).
- Never edit an already-applied migration file; every change is a new migration.
- Associates: view project/tasks/comments/members; comment + attach on any task in their projects; change **only `status`** of tasks they are assigned to. No task create/delete/assign, no member management.
- Only Super-Admin (any project) or Admin who is a member of the project may invite associates. Managers/Staff may not.
- An email belonging to a workspace user cannot become an associate (409).
- Associates do not count toward workspace seats or the 3-workspace project cap.
- Removing an associate from their last project sets `users.status='suspended'`; re-inviting reactivates.
- Notification types: `project_added`, `project_task_assigned`, `project_task_comment`, `project_task_created`, `project_task_status`. The actor is never notified of their own action.
- Emails: every `project_added` (any role) and every other `project_*` notification whose recipient is an associate. One email per notification, no retries, failures only logged.
- Project link format: `https://digitracker-app.digi5y.co/#/projects/<projectId>`.
- File paths in user-facing chat must be markdown links, not backticks (user preference).
- Commit messages: conventional (`feat:`/`fix:`/`test:`/`chore:`), ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Run tests with `corepack pnpm vitest run`, types with `corepack pnpm tsc --noEmit`.

## Review Focus

1. **A suspended associate** must still be treated as an associate by the lock — `is_associate()` checks role regardless of `status` (pinned in Task 2's static test of the function body).
2. **An associate calling a SECURITY DEFINER RPC directly** (e.g. `/rpc/get_team_status`, `/rpc/debug_data_isolation`) must be rejected — pinned by the pre-request guard allow-list test in Task 2 and the live check in Task 10.
3. **An associate uploading/reading `task-attachments` for a task outside their projects** (paths are `<taskId>/<file>`) must be denied — pinned by the storage policy + live check in Task 10.
4. **Duplicate notifications**: the existing client-side `notifications.insert` loops in the task modals must skip associates now that triggers notify them — pinned by tests in Task 9.
5. **Inviting an email that already exists as a workspace user**, in any letter case, must return 409 and change nothing — pinned in Task 6 (case-insensitive lookup) and Task 7 (UI message test).

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20261006000000_associates_role.sql` | Role/constraints, `is_associate()`, `notifications.project_id`, seat/cap/removal changes, `get_project_member_status` returns role |
| `supabase/migrations/20261006000100_associates_lock.sql` | Restrictive deny policies, `users`/`notifications`/`storage` scoping, pre-request guard, `associate_lock_gaps()` |
| `supabase/migrations/20261006000200_associates_project_rules.sql` | Associate task rules + status-only trigger |
| `supabase/migrations/20261006000300_project_activity_notifications.sql` | Triggers writing `project_task_*` notifications |
| `supabase/migrations/20261006000400_notification_email_dispatch.sql` | pg_net dispatch trigger on `notifications` |
| `supabase/functions/_shared/projectEmails.ts` | Generalised `sendProjectNotificationEmail` (replaces `sendProjectAddedEmail`) |
| `supabase/functions/send-notification-email/index.ts` | Secret-authenticated email sender |
| `supabase/functions/invite-associate/index.ts` | Invite/re-add associates |
| `supabase/functions/notify-project-member/` | **Deleted** |
| `src/features/projects/notifyProjectMember.ts` | **Deleted** |
| `src/features/notifications/notifIcon.ts` | Shared notification icon map |
| `src/features/notifications/NotificationsBell.tsx` | Bell + dropdown for associates |
| `src/features/projects/InviteAssociateForm.tsx` | Invite form used by Super-Admin panel and Admin project page |
| `src/app/AssociateLayout.tsx` | Associate shell: project-only sidebar, bell, route gating |
| `src/features/projects/NoProjectsPage.tsx` | "Not added to a project yet" |
| `src/__tests__/associateLock.test.ts` | Static guard: lock coverage of future tables, `is_associate` body, guard allow-list |

---

### Task 1: Associate role, limits, and member-status role column

**Files:**
- Create: `supabase/migrations/20261006000000_associates_role.sql`
- Modify: `src/types/index.ts` (`User['role']` union, `Notification`)
- Modify: `src/features/projects/ProjectPage.tsx:31-39,132-168` (use real `role`)

**Interfaces:**
- Produces: SQL `public.is_associate() returns boolean`; `notifications.project_id uuid null`; `get_project_member_status(uuid)` now returns `(user_id, name, profile_image, role, status, last_activity_at)`; TS `User['role']` includes `'Associate'`; `Notification` has `project_id: string | null` and the five `project_*` types.

- [ ] **Step 1: Write the migration**

```sql
-- Migration 20261006000000: Associate role foundation.
-- See docs/superpowers/specs/2026-10-05-project-associates-design.md §1.

alter table public.users drop constraint if exists users_role_check;
alter table public.users add constraint users_role_check
  check (role in ('Super-Admin', 'Admin', 'Manager', 'Staff', 'Associate'));

-- Associates, and only associates, live in the ASSOCIATE sentinel workspace.
alter table public.users add constraint users_associate_sub_account
  check ((role = 'Associate') = (sub_account = 'ASSOCIATE'));

alter table public.sub_accounts add constraint sub_accounts_code_not_reserved
  check (upper(code) <> 'ASSOCIATE');

-- Deliberately ignores users.status: a suspended associate must still be
-- locked out by every *_deny_associates policy.
create or replace function public.is_associate()
  returns boolean
  language sql security definer stable
  set search_path = public
as $$
  select coalesce(
    (select role = 'Associate' from public.users
      where lower(email) = lower(auth.email()) limit 1),
    false)
$$;
grant execute on function public.is_associate() to authenticated;

-- Lets the email function link straight to the project.
alter table public.notifications
  add column if not exists project_id uuid references public.projects(id) on delete cascade;

create or replace function public.sub_account_seat_count(p_sub_account text)
  returns int
  language sql security definer stable
as $$
  select count(*)::int from public.users
  where sub_account = p_sub_account and role <> 'Associate'
$$;

-- add_project_member: copied from 20261005000000 with three changes —
-- (1) associates don't count toward / aren't blocked by the 3-workspace cap,
-- (2) the notification records project_id,
-- (3) adding an associate reactivates a suspended associate account.
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
    return;
  end if;

  if v_target_sub <> 'ASSOCIATE' then
    select count(distinct u.sub_account) into v_distinct_subs
      from public.project_members pm
      join public.users u on u.id = pm.user_id
      where pm.project_id = p_project_id and u.sub_account <> 'ASSOCIATE';

    if v_distinct_subs >= 3 and not exists (
      select 1 from public.project_members pm2
      join public.users u2 on u2.id = pm2.user_id
      where pm2.project_id = p_project_id and u2.sub_account = v_target_sub
    ) then
      raise exception 'This project already has members from 3 workspaces — remove one before adding a member from a 4th.';
    end if;
  else
    update public.users set status = 'active' where id = p_user_id and status <> 'active';
  end if;

  insert into public.project_members (project_id, user_id) values (p_project_id, p_user_id);

  if p_user_id is distinct from v_caller_id then
    insert into public.notifications (user_id, type, message, read, project_id)
    values (
      p_user_id,
      'project_added',
      format('%s added you to the project "%s" — find it in your sidebar as PROJECTS-%s.',
             coalesce(v_caller_name, 'An administrator'), v_project_name, v_project_name),
      false,
      p_project_id
    );
  end if;
end;
$$;

-- remove_project_member: same authorization as 055, plus suspend an
-- associate who no longer belongs to any project.
create or replace function public.remove_project_member(p_project_id uuid, p_user_id uuid)
  returns void
  language plpgsql security definer
  set search_path = public
as $$
begin
  if public.auth_user_role() is distinct from 'Super-Admin' then
    raise exception 'Only Super-Admin can manage project membership';
  end if;

  delete from public.project_members where project_id = p_project_id and user_id = p_user_id;

  update public.users u set status = 'suspended'
   where u.id = p_user_id
     and u.role = 'Associate'
     and not exists (select 1 from public.project_members pm where pm.user_id = p_user_id);
end;
$$;

-- get_project_member_status gains `role` (return type change → drop first).
drop function if exists public.get_project_member_status(uuid);
create function public.get_project_member_status(p_project_id uuid)
  returns table (
    user_id          uuid,
    name             text,
    profile_image    text,
    role             text,
    status           text,
    last_activity_at timestamptz
  )
  language sql security definer stable
as $$
  select distinct on (u.id)
    u.id, u.name, u.profile_image, u.role, tl.status, tl.last_activity_at
  from public.project_members pm
  join public.users u on u.id = pm.user_id
  left join public.time_logs tl
    on tl.user_id = u.id
    and tl.status in ('working', 'lunch')
    and tl.clock_in > now() - interval '24 hours'
  where pm.project_id = p_project_id
    and public.is_project_member(p_project_id)
  order by u.id, tl.clock_in desc nulls last
$$;
grant execute on function public.get_project_member_status(uuid) to authenticated;

notify pgrst, 'reload schema';
```

- [ ] **Step 2: Update TS types**

In `src/types/index.ts`: add `'Associate'` to the `User['role']` union (find it with `grep -n "role:" src/types/index.ts`), and change `Notification` to:

```ts
export interface Notification {
  id: string
  user_id: string
  type: 'task_assigned' | 'task_reply' | 'task_completed' | 'task_closed' | 'leave_request' | 'leave_approved' | 'leave_rejected' | 'holiday_added' | 'new_subscription'
    | 'project_added' | 'project_task_assigned' | 'project_task_comment' | 'project_task_created' | 'project_task_status'
  message: string
  read: boolean
  created_at: string
  project_id: string | null
}
```

- [ ] **Step 3: Use the real role in ProjectPage**

In `src/features/projects/ProjectPage.tsx` add `role: User['role']` to `ProjectMemberStatusRow` (after `profile_image`), and in the `memberRows.map` replace `role: 'Staff',` with `role: r.role,`. Update the comment above the map: role is now returned so the UI can mark associates and skip client-side notifications for them.

- [ ] **Step 4: Type-check and run tests**

Run: `corepack pnpm tsc --noEmit && corepack pnpm vitest run`
Expected: tsc exits 0 (fix any exhaustive `switch` on role that now misses `'Associate'` by adding a case that mirrors `'Staff'`); all tests pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261006000000_associates_role.sql src/types/index.ts src/features/projects/ProjectPage.tsx
git commit -m "feat: add Associate role, project_id on notifications, associate-aware membership RPCs"
```

---

### Task 2: The associate lock (RLS + pre-request guard) and its static test

**Files:**
- Create: `supabase/migrations/20261006000100_associates_lock.sql`
- Create: `src/__tests__/associateLock.test.ts`

**Interfaces:**
- Consumes: `public.is_associate()` (Task 1).
- Produces: policies named `<table>_deny_associates`; SQL `public.associate_request_guard()`; SQL `public.associate_lock_gaps() returns table(table_name text, problem text)` (Super-Admin only); constant allow-lists that later tasks must not widen without updating the test.

- [ ] **Step 1: Write the failing static test**

```ts
// src/__tests__/associateLock.test.ts
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'

const MIGRATIONS_DIR = join(__dirname, '../../supabase/migrations')
const LOCK_MIGRATION = '20261006000100_associates_lock.sql'
// Tables associates legitimately touch — scoped by their own rules instead.
const PROJECT_TABLES = ['projects', 'project_members', 'project_tasks', 'project_task_assignees', 'project_task_comments', 'notifications', 'users']

const files = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort()
const read = (f: string) => readFileSync(join(MIGRATIONS_DIR, f), 'utf8')

describe('associate lock', () => {
  it('exists', () => {
    expect(files).toContain(LOCK_MIGRATION)
  })

  it('every table created after the lock migration gets its own *_deny_associates policy', () => {
    const later = files.filter(f => f > LOCK_MIGRATION)
    const allSql = later.map(read).join('\n')
    const created = [...allSql.matchAll(/create table (?:if not exists )?public\.(\w+)/gi)].map(m => m[1])
    const missing = created.filter(t =>
      !PROJECT_TABLES.includes(t) && !new RegExp(`"?${t}_deny_associates"?`, 'i').test(allSql))
    expect(missing).toEqual([])
  })

  it('is_associate() ignores status so suspended associates stay locked out', () => {
    const body = read('20261006000000_associates_role.sql').match(/function public\.is_associate\(\)[\s\S]*?\$\$([\s\S]*?)\$\$/)?.[1] ?? ''
    expect(body).toMatch(/role = 'Associate'/)
    expect(body).not.toMatch(/status/)
  })

  it('pre-request guard only allows project tables and safe RPCs', () => {
    const sql = read(LOCK_MIGRATION)
    const tables = sql.match(/v_path ~ '\^\/\(([^)]+)\)\$'/)?.[1].split('|') ?? []
    const rpcs = sql.match(/v_path ~ '\^\/rpc\/\(([^)]+)\)\$'/)?.[1].split('|') ?? []
    expect(tables.sort()).toEqual([...PROJECT_TABLES].sort())
    expect(rpcs.sort()).toEqual(['check_account_status', 'get_project_member_status', 'is_associate', 'is_project_member'])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `corepack pnpm vitest run src/__tests__/associateLock.test.ts`
Expected: FAIL — `expected [...] to contain '20261006000100_associates_lock.sql'` (and the guard test fails on empty arrays).

- [ ] **Step 3: Write the lock migration**

```sql
-- Migration 20261006000100: lock associates out of everything except Projects.
-- Two independent layers (spec §1.2):
--   1. RESTRICTIVE RLS policies — AND-ed with every permissive policy.
--   2. PostgREST db_pre_request guard — rejects any non-allow-listed table or
--      RPC path for associates. Needed because SECURITY DEFINER RPCs bypass RLS.
-- Any table created after this migration must add its own
-- "<table>_deny_associates" policy (enforced by src/__tests__/associateLock.test.ts).

-- ── Layer 1a: blanket deny on every existing non-project table ─────────────
do $$
declare t text;
begin
  for t in
    select tablename from pg_tables
    where schemaname = 'public'
      and tablename not in ('projects', 'project_members', 'project_tasks',
                            'project_task_assignees', 'project_task_comments',
                            'notifications', 'users')
  loop
    execute format('drop policy if exists %I on public.%I', t || '_deny_associates', t);
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated '
      'using (not public.is_associate()) with check (not public.is_associate())',
      t || '_deny_associates', t);
  end loop;
end $$;

-- ── Layer 1b: users — own row + people sharing a project; no writes ────────
create or replace function public.shares_project_with(p_user_id uuid)
  returns boolean
  language sql security definer stable
  set search_path = public
as $$
  select exists (
    select 1 from public.project_members a
    join public.project_members b on b.project_id = a.project_id
    where a.user_id = public.auth_user_app_id() and b.user_id = p_user_id
  )
$$;

drop policy if exists users_associate_select on public.users;
create policy users_associate_select on public.users
  as restrictive for select to authenticated
  using (not public.is_associate() or lower(email) = lower(auth.email()) or public.shares_project_with(id));

drop policy if exists users_associate_no_insert on public.users;
create policy users_associate_no_insert on public.users
  as restrictive for insert to authenticated with check (not public.is_associate());
drop policy if exists users_associate_no_update on public.users;
create policy users_associate_no_update on public.users
  as restrictive for update to authenticated using (not public.is_associate());
drop policy if exists users_associate_no_delete on public.users;
create policy users_associate_no_delete on public.users
  as restrictive for delete to authenticated using (not public.is_associate());

-- ── Layer 1c: notifications — associates never insert (triggers do) ────────
drop policy if exists notifications_associate_no_insert on public.notifications;
create policy notifications_associate_no_insert on public.notifications
  as restrictive for insert to authenticated with check (not public.is_associate());

-- ── Layer 1d: storage — only task-attachments of tasks in their projects ───
-- Paths are "<project_task_id>/<file>" (ProjectTaskDetailModal/CreateProjectTaskModal).
drop policy if exists storage_associate_scope on storage.objects;
create policy storage_associate_scope on storage.objects
  as restrictive for all to authenticated
  using (
    not public.is_associate()
    or (bucket_id = 'task-attachments' and exists (
      select 1 from public.project_tasks pt
      where pt.id::text = (storage.foldername(name))[1]
        and public.is_project_member(pt.project_id)))
  )
  with check (
    not public.is_associate()
    or (bucket_id = 'task-attachments' and exists (
      select 1 from public.project_tasks pt
      where pt.id::text = (storage.foldername(name))[1]
        and public.is_project_member(pt.project_id)))
  );

-- ── Layer 2: PostgREST pre-request guard ──────────────────────────────────
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
  if v_path ~ '^/(projects|project_members|project_tasks|project_task_assignees|project_task_comments|notifications|users)$'
     or v_path ~ '^/rpc/(get_project_member_status|is_project_member|check_account_status|is_associate)$' then
    return;
  end if;
  raise exception 'Not available to associates' using errcode = '42501';
end;
$$;
grant execute on function public.associate_request_guard() to authenticated, anon;

alter role authenticator set pgrst.db_pre_request = 'public.associate_request_guard';
notify pgrst, 'reload config';

-- ── Post-deploy self-check (Super-Admin only) ──────────────────────────────
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
                              'notifications', 'users')
      and not exists (select 1 from pg_policies p
                      where p.schemaname = 'public' and p.tablename = t.tablename
                        and p.policyname = t.tablename || '_deny_associates')
    union all
    select c.relname::text, 'row level security disabled'::text
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
end;
$$;
grant execute on function public.associate_lock_gaps() to authenticated;

notify pgrst, 'reload schema';
```

Note: `associate_lock_gaps` is callable by Super-Admin from the app; it is not on the associate allow-list.

- [ ] **Step 4: Run the test to verify it passes**

Run: `corepack pnpm vitest run src/__tests__/associateLock.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261006000100_associates_lock.sql src/__tests__/associateLock.test.ts
git commit -m "feat: lock associates out of non-project tables, storage, and RPCs"
```

---

### Task 3: What associates may do inside a project

**Files:**
- Create: `supabase/migrations/20261006000200_associates_project_rules.sql`
- Modify: `src/__tests__/associateLock.test.ts` (append one test)

**Interfaces:**
- Consumes: `is_associate()`.
- Produces: SQL `public.is_project_task_assignee(p_task_id uuid) returns boolean`; trigger `project_tasks_associate_status_only`.

- [ ] **Step 1: Append the failing static test**

```ts
describe('associate project rules', () => {
  it('limits associates to status-only updates on assigned tasks and blocks create/delete/assign', () => {
    const sql = read('20261006000200_associates_project_rules.sql')
    for (const name of [
      'project_tasks_associate_update', 'project_tasks_associate_no_insert', 'project_tasks_associate_no_delete',
      'project_task_assignees_associate_no_insert', 'project_task_assignees_associate_no_update', 'project_task_assignees_associate_no_delete',
    ]) expect(sql).toContain(name)
    expect(sql).toMatch(/new\.title.*is distinct from.*old\.title/s)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm vitest run src/__tests__/associateLock.test.ts`
Expected: FAIL — ENOENT for `20261006000200_associates_project_rules.sql`.

- [ ] **Step 3: Write the migration**

```sql
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `corepack pnpm vitest run src/__tests__/associateLock.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261006000200_associates_project_rules.sql src/__tests__/associateLock.test.ts
git commit -m "feat: restrict associates to status-only updates on their assigned project tasks"
```

---

### Task 4: Project activity notifications (triggers) and shared icons

**Files:**
- Create: `supabase/migrations/20261006000300_project_activity_notifications.sql`
- Create: `src/features/notifications/notifIcon.ts`
- Create: `src/features/notifications/__tests__/notifIcon.test.ts`
- Modify: `src/features/time-tracking/TimeTrackingPage.tsx:220-233` (import shared `notifIcon`, delete local function)

**Interfaces:**
- Consumes: `notifications.project_id` (Task 1).
- Produces: TS `notifIcon(type: string): string` exported from `src/features/notifications/notifIcon.ts`.

- [ ] **Step 1: Write the failing icon test**

```ts
// src/features/notifications/__tests__/notifIcon.test.ts
import { describe, it, expect } from 'vitest'
import { notifIcon } from '../notifIcon'

describe('notifIcon', () => {
  it.each([
    ['project_added', '🗂'], ['project_task_assigned', '✅'], ['project_task_comment', '💬'],
    ['project_task_created', '🆕'], ['project_task_status', '🔄'], ['task_reply', '💬'], ['unknown', '🔔'],
  ])('%s → %s', (type, icon) => expect(notifIcon(type)).toBe(icon))
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm vitest run src/features/notifications`
Expected: FAIL — cannot resolve `../notifIcon`.

- [ ] **Step 3: Implement `notifIcon.ts` and use it in TimeTrackingPage**

```ts
// src/features/notifications/notifIcon.ts
export function notifIcon(type: string): string {
  switch (type) {
    case 'task_assigned':         return '✅'
    case 'task_reply':            return '💬'
    case 'task_completed':        return '🏁'
    case 'task_closed':           return '🔒'
    case 'leave_request':         return '📋'
    case 'leave_approved':        return '✅'
    case 'leave_rejected':        return '❌'
    case 'holiday_added':         return '🗓'
    case 'new_subscription':      return '💳'
    case 'project_added':         return '🗂'
    case 'project_task_assigned': return '✅'
    case 'project_task_comment':  return '💬'
    case 'project_task_created':  return '🆕'
    case 'project_task_status':   return '🔄'
    default:                      return '🔔'
  }
}
```

In `TimeTrackingPage.tsx` delete the local `function notifIcon(...) {...}` and add `import { notifIcon } from '@/features/notifications/notifIcon'`.

- [ ] **Step 4: Write the trigger migration**

```sql
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
```

- [ ] **Step 5: Run tests + types**

Run: `corepack pnpm tsc --noEmit && corepack pnpm vitest run`
Expected: tsc 0; all pass.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261006000300_project_activity_notifications.sql src/features/notifications src/features/time-tracking/TimeTrackingPage.tsx
git commit -m "feat: notify associates of project task activity via database triggers"
```

---

### Task 5: Email pipeline (pg_net → send-notification-email); retire notify-project-member

**Files:**
- Create: `supabase/migrations/20261006000400_notification_email_dispatch.sql`
- Create: `supabase/functions/send-notification-email/index.ts`
- Modify: `supabase/functions/_shared/projectEmails.ts` (replace `sendProjectAddedEmail` with `sendProjectNotificationEmail`)
- Delete: `supabase/functions/notify-project-member/index.ts`, `src/features/projects/notifyProjectMember.ts`
- Modify: `src/features/super-admin/ProjectDetailPanel.tsx` (drop email call), `src/features/projects/CreateProjectTaskModal.tsx` (drop email call), `src/features/super-admin/__tests__/ProjectDetailPanel.test.tsx` (replace notifying-tests block)
- Modify: `.github/workflows/deploy.yml` (no-verify-jwt + secret)

**Interfaces:**
- Produces: edge function `send-notification-email` accepting `POST {notificationId: string}` with header `x-notification-secret`; returns `{sent: boolean, error: string|null}`. TS `sendProjectNotificationEmail(admin, {toEmail, memberName, projectId, projectName, subject, message})`.

- [ ] **Step 1: Replace the ProjectDetailPanel notification tests (failing first)**

In `ProjectDetailPanel.test.tsx`, replace the whole `describe('ProjectDetailPanel — notifying the added member', …)` block with:

```ts
describe('ProjectDetailPanel — added-member feedback', () => {
  beforeEach(() => {
    rpcMock.mockReset()
    invokeMock.mockReset()
    membersSelectMock.mockReset().mockResolvedValue({ data: [] })
    usersSelectMock.mockReset().mockResolvedValue({
      data: [{ id: 'u9', name: 'New Person', email: 'new@x.com', sub_account: 'AM999', role: 'Staff' }],
    })
  })

  it('tells the admin the member will be notified, without calling any edge function', async () => {
    rpcMock.mockResolvedValueOnce({ error: null })
    render(<ProjectDetailPanel project={project} onClose={vi.fn()} />)

    await userEvent.type(await screen.findByPlaceholderText(/search by email/i), 'new@x.com')
    await userEvent.click(await screen.findByText('Add'))

    await screen.findByText('Member added — they will be notified in the app and by email.')
    expect(invokeMock).not.toHaveBeenCalled()
  })
})
```

Run: `corepack pnpm vitest run src/features/super-admin`
Expected: FAIL — text not found (panel still says "Member added and notified by email.").

- [ ] **Step 2: Remove the client email call**

`ProjectDetailPanel.tsx` `handleAdd`: replace the `notifyProjectMember` lines and `setMsg(emailError ? … : …)` with
`setMsg({ type: 'success', text: 'Member added — they will be notified in the app and by email.' })`, and delete the `notifyProjectMember` import.
`CreateProjectTaskModal.tsx`: delete the `void notifyProjectMember(projectId, c.id)` line, its comment, and the import.
Delete `src/features/projects/notifyProjectMember.ts` and `supabase/functions/notify-project-member/`.

Run: `corepack pnpm vitest run src/features/super-admin && corepack pnpm tsc --noEmit`
Expected: PASS; tsc 0.

- [ ] **Step 3: Generalise the email helper**

Replace the body of `supabase/functions/_shared/projectEmails.ts` below `escapeHtml` with:

```ts
export interface ProjectNotificationInfo {
  toEmail: string
  memberName: string
  projectId: string
  projectName: string
  subject: string
  message: string
}

// Never throws — the in-app notification already exists by the time this runs.
export async function sendProjectNotificationEmail(
  admin: ReturnType<typeof createClient>,
  info: ProjectNotificationInfo,
): Promise<{ sent: boolean; error: string | null }> {
  try {
    const { smtp, error } = await getPlatformSmtp(admin)
    if (!smtp) return { sent: false, error }
    const { client, from } = smtp

    const projectUrl = `${APP_URL}/#/projects/${encodeURIComponent(info.projectId)}`

    await client.send({
      from,
      to: info.toEmail,
      subject: info.subject,
      content: 'auto',
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
          <p>Hi ${escapeHtml(info.memberName)},</p>
          <p>${escapeHtml(info.message)}</p>
          <p>Project: <strong>${escapeHtml(info.projectName)}</strong></p>
          <p><a href="${projectUrl}" style="display:inline-block;background:#7c3aed;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;">Open project</a></p>
        </div>`,
    })

    await client.close()
    return { sent: true, error: null }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('sendProjectNotificationEmail failed:', err)
    return { sent: false, error: message }
  }
}
```

Also update the file's header comment to describe all project notification emails, and remove the `ProjectAddedInfo` interface.

- [ ] **Step 4: Write `send-notification-email`**

```ts
// supabase/functions/send-notification-email/index.ts
// Called only by the notifications_dispatch_email database trigger (pg_net),
// never by browsers. Deployed --no-verify-jwt; the shared secret header is
// the auth boundary.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendProjectNotificationEmail } from '../_shared/projectEmails.ts'

const SUBJECTS: Record<string, (project: string) => string> = {
  project_added:         p => `You've been added to the project "${p}" on DIGITRACKER`,
  project_task_assigned: p => `New task assigned to you in "${p}"`,
  project_task_comment:  p => `New comment on your task in "${p}"`,
  project_task_created:  p => `New task in "${p}"`,
  project_task_status:   p => `Task status changed in "${p}"`,
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const expected = Deno.env.get('NOTIFICATION_EMAIL_SECRET') ?? ''
  const provided = req.headers.get('x-notification-secret') ?? ''
  if (!expected || !safeEqual(provided, expected)) return json({ error: 'Forbidden' }, 403)

  let notificationId: unknown
  try {
    ({ notificationId } = await req.json())
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }
  if (typeof notificationId !== 'string' || !notificationId) return json({ error: 'notificationId is required' }, 400)

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const { data: n } = await admin
    .from('notifications')
    .select('type, message, project_id, users(name, email), projects(name)')
    .eq('id', notificationId)
    .maybeSingle()
  const row = n as { type: string; message: string; project_id: string | null;
    users: { name: string; email: string } | null; projects: { name: string } | null } | null
  if (!row?.users || !row.project_id || !row.projects) return json({ error: 'Notification not found or not project-scoped' }, 404)

  const subjectFor = SUBJECTS[row.type]
  if (!subjectFor) return json({ error: `Unsupported type ${row.type}` }, 400)

  const result = await sendProjectNotificationEmail(admin, {
    toEmail: row.users.email,
    memberName: row.users.name,
    projectId: row.project_id,
    projectName: row.projects.name,
    subject: subjectFor(row.projects.name),
    message: row.message,
  })
  if (!result.sent) console.error(`send-notification-email ${notificationId}: ${result.error}`)
  return json(result)
})
```

- [ ] **Step 5: Write the dispatch migration**

```sql
-- Migration 20261006000400: email project notifications (spec §3.2).
-- One-time manual setup (see Task 10): Vault secret "notification_email_secret"
-- must equal the edge function secret NOTIFICATION_EMAIL_SECRET.

create extension if not exists pg_net with schema extensions;

create or replace function public.dispatch_notification_email()
  returns trigger
  language plpgsql security definer
  set search_path = public
as $$
declare
  v_secret text;
begin
  if new.type not like 'project\_%' or new.project_id is null then
    return new;
  end if;
  if new.type <> 'project_added'
     and not exists (select 1 from public.users where id = new.user_id and role = 'Associate') then
    return new;
  end if;

  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'notification_email_secret';
  if v_secret is null then
    raise warning 'notification_email_secret not set in Vault; email for notification % skipped', new.id;
    return new;
  end if;

  perform net.http_post(
    url     := 'https://mllrjejqyddgaxxtjsqf.supabase.co/functions/v1/send-notification-email',
    body    := jsonb_build_object('notificationId', new.id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-notification-secret', v_secret)
  );
  return new;
end;
$$;

drop trigger if exists notifications_dispatch_email on public.notifications;
create trigger notifications_dispatch_email
  after insert on public.notifications
  for each row execute function public.dispatch_notification_email();
```

- [ ] **Step 6: CI changes**

In `.github/workflows/deploy.yml`:
- `NO_VERIFY_JWT="oauth-callback crm-webhook stripe-webhook send-notification-email"`
- In the "Set GHL edge function secrets" step add a line to the `supabase secrets set` call:
  `NOTIFICATION_EMAIL_SECRET="${{ secrets.NOTIFICATION_EMAIL_SECRET }}" \`
  (keep the trailing backslashes consistent).

- [ ] **Step 7: Verify and commit**

Run: `corepack pnpm tsc --noEmit && corepack pnpm vitest run`
Expected: tsc 0; all pass.

```bash
git add -A supabase/functions supabase/migrations/20261006000400_notification_email_dispatch.sql src .github/workflows/deploy.yml
git commit -m "feat: email project notifications from the database; retire notify-project-member"
```

---

### Task 6: `invite-associate` edge function

**Files:**
- Create: `supabase/functions/invite-associate/index.ts`

**Interfaces:**
- Produces: `POST /functions/v1/invite-associate` body `{projectId: string, email: string, name: string}` (user JWT required) → 200 `{status: 'invited' | 'added' | 'already_member'}`; 400 validation; 403 not allowed; 404 project; 409 `{error: 'This email belongs to a workspace user — add them as a normal member instead.'}`; 500 `{error}`.

- [ ] **Step 1: Confirm users-insert prerequisites**

Run: `grep -rn "create trigger\|before insert" supabase/migrations/*.sql | grep -i users`
Expected: no seat/role trigger on `public.users` inserts (seat limits are RLS-only, which the service role bypasses). If a trigger exists, read it and make sure an `ASSOCIATE` row passes; note it in the commit message.

- [ ] **Step 2: Write the function**

```ts
// supabase/functions/invite-associate/index.ts
// Invites an outside collaborator ("associate") into a project. See
// docs/superpowers/specs/2026-10-05-project-associates-design.md §2.2.
// Authorization: Super-Admin, or an Admin who is a member of the project.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const APP_URL = 'https://digitracker-app.digi5y.co'
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'Missing authorization header' }, 401)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey     = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } })
  const { data: { user: callerAuth }, error: callerErr } = await callerClient.auth.getUser()
  if (callerErr || !callerAuth?.email) return json({ error: 'Invalid session' }, 401)

  let body: { projectId?: unknown; email?: unknown; name?: unknown }
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON body' }, 400) }
  const projectId = typeof body.projectId === 'string' ? body.projectId : ''
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!projectId) return json({ error: 'projectId is required' }, 400)
  if (!EMAIL_RE.test(email)) return json({ error: 'A valid email address is required' }, 400)
  if (!name) return json({ error: 'Name is required' }, 400)

  // Service-role client — the checks below are the security boundary.
  const admin = createClient(supabaseUrl, serviceKey)

  const { data: caller } = await admin.from('users').select('id, name, role')
    .ilike('email', callerAuth.email).eq('status', 'active').maybeSingle()
  if (!caller) return json({ error: 'Caller not found' }, 403)

  const { data: project } = await admin.from('projects').select('id, name').eq('id', projectId).maybeSingle()
  if (!project) return json({ error: 'Project not found' }, 404)

  if (caller.role !== 'Super-Admin') {
    if (caller.role !== 'Admin') return json({ error: 'Only Super-Admins and Admins can invite associates' }, 403)
    const { data: m } = await admin.from('project_members').select('user_id')
      .eq('project_id', projectId).eq('user_id', caller.id).maybeSingle()
    if (!m) return json({ error: 'You must be a member of this project to invite associates' }, 403)
  }

  const { data: existing } = await admin.from('users').select('id, role, status').ilike('email', email).maybeSingle()
  if (existing && existing.role !== 'Associate') {
    return json({ error: 'This email belongs to a workspace user — add them as a normal member instead.' }, 409)
  }

  let userId: string
  let status: 'invited' | 'added' | 'already_member' = 'added'
  if (!existing) {
    const { data: created, error: insErr } = await admin.from('users')
      .insert({ email, name, role: 'Associate', sub_account: 'ASSOCIATE', status: 'active' })
      .select('id').single()
    if (insErr || !created) return json({ error: `Could not create associate: ${insErr?.message}` }, 500)
    userId = created.id as string
    status = 'invited'
  } else {
    userId = existing.id as string
    if (existing.status !== 'active') {
      await admin.from('users').update({ status: 'active' }).eq('id', userId)
    }
  }

  const { data: already } = await admin.from('project_members').select('user_id')
    .eq('project_id', projectId).eq('user_id', userId).maybeSingle()
  if (already) {
    status = status === 'invited' ? 'invited' : 'already_member'
  } else {
    const { error: memErr } = await admin.from('project_members').insert({ project_id: projectId, user_id: userId })
    if (memErr) return json({ error: `Could not add to project: ${memErr.message}` }, 500)
    // Same text as add_project_member; the dispatch trigger emails it.
    await admin.from('notifications').insert({
      user_id: userId, type: 'project_added', read: false, project_id: projectId,
      message: `${caller.name} added you to the project "${project.name}" — find it in your sidebar as PROJECTS-${project.name}.`,
    })
  }

  if (status === 'invited') {
    // Same sign-in mechanism as Settings → Users → Add User.
    const anon = createClient(supabaseUrl, anonKey)
    const { error: otpErr } = await anon.auth.signInWithOtp({ email, options: { emailRedirectTo: APP_URL } })
    if (otpErr) return json({ status, error: `Added, but the sign-in invite failed: ${otpErr.message}` })
  }

  return json({ status })
})
```

- [ ] **Step 3: Type-check the Deno file if Deno is available**

Run: `command -v deno && deno check supabase/functions/invite-associate/index.ts supabase/functions/send-notification-email/index.ts || echo "deno not installed — CI deploy will compile it"`
Expected: no type errors, or the fallback message.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/invite-associate
git commit -m "feat: add invite-associate edge function"
```

---

### Task 7: Invite form in the Super-Admin panel and the Admin project page

**Files:**
- Create: `src/features/projects/InviteAssociateForm.tsx`
- Create: `src/features/projects/__tests__/InviteAssociateForm.test.tsx`
- Modify: `src/features/super-admin/ProjectDetailPanel.tsx` (render form; amber badge for Associate)
- Modify: `src/features/projects/ProjectPage.tsx` (render form for `user.role === 'Admin'`)

**Interfaces:**
- Consumes: edge function `invite-associate` (Task 6).
- Produces: `<InviteAssociateForm projectId: string onInvited: () => void />`.

- [ ] **Step 1: Write the failing tests**

```tsx
// src/features/projects/__tests__/InviteAssociateForm.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const invokeMock = vi.fn()
vi.mock('@/lib/supabase', () => ({
  supabase: { functions: { invoke: (...a: unknown[]) => invokeMock(...a) } },
}))

import { InviteAssociateForm } from '../InviteAssociateForm'

async function submit(email = 'Guest@Partner.com', name = 'Guest') {
  await userEvent.type(screen.getByPlaceholderText(/associate email/i), email)
  await userEvent.type(screen.getByPlaceholderText(/full name/i), name)
  await userEvent.click(screen.getByRole('button', { name: /invite associate/i }))
}

describe('InviteAssociateForm', () => {
  beforeEach(() => invokeMock.mockReset())

  it('invites a new associate and reports it', async () => {
    const onInvited = vi.fn()
    invokeMock.mockResolvedValueOnce({ data: { status: 'invited' }, error: null })
    render(<InviteAssociateForm projectId="p1" onInvited={onInvited} />)
    await submit()
    expect(invokeMock).toHaveBeenCalledWith('invite-associate', { body: { projectId: 'p1', email: 'Guest@Partner.com', name: 'Guest' } })
    await screen.findByText(/invited — a sign-in link was sent to Guest@Partner.com/i)
    expect(onInvited).toHaveBeenCalled()
  })

  it('reports re-adding an existing associate', async () => {
    invokeMock.mockResolvedValueOnce({ data: { status: 'added' }, error: null })
    render(<InviteAssociateForm projectId="p1" onInvited={vi.fn()} />)
    await submit()
    await screen.findByText(/added to this project/i)
  })

  it('shows the 409 message for a workspace user and does not call onInvited', async () => {
    const onInvited = vi.fn()
    invokeMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'Edge Function returned a non-2xx status code', context: new Response(JSON.stringify({ error: 'This email belongs to a workspace user — add them as a normal member instead.' }), { status: 409 }) },
    })
    render(<InviteAssociateForm projectId="p1" onInvited={onInvited} />)
    await submit()
    await screen.findByText(/belongs to a workspace user/i)
    expect(onInvited).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `corepack pnpm vitest run src/features/projects/__tests__/InviteAssociateForm.test.tsx`
Expected: FAIL — cannot resolve `../InviteAssociateForm`.

- [ ] **Step 3: Implement the form**

```tsx
// src/features/projects/InviteAssociateForm.tsx
import { useState } from 'react'
import { supabase } from '@/lib/supabase'

interface Props {
  projectId: string
  onInvited: () => void
}

type InviteResult = { status?: 'invited' | 'added' | 'already_member'; error?: string }

// supabase-js wraps non-2xx responses in a FunctionsHttpError whose
// `context` is the raw Response — read the function's own error message.
async function readFunctionError(error: { message: string; context?: unknown }): Promise<string> {
  if (error.context instanceof Response) {
    try {
      const body = await error.context.json() as { error?: string }
      if (body.error) return body.error
    } catch { /* fall through */ }
  }
  return error.message
}

export function InviteAssociateForm({ projectId, onInvited }: Props) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    const { data, error } = await supabase.functions.invoke('invite-associate', { body: { projectId, email, name } })
    setBusy(false)
    if (error) { setMsg({ type: 'error', text: await readFunctionError(error) }); return }

    const result = (data ?? {}) as InviteResult
    const text =
      result.status === 'invited' ? `${name} invited — a sign-in link was sent to ${email}.`
      : result.status === 'already_member' ? `${email} is already in this project.`
      : `${name} added to this project and notified.`
    setMsg({ type: result.error ? 'error' : 'success', text: result.error ? `${text} ${result.error}` : text })
    setEmail('')
    setName('')
    onInvited()
  }

  return (
    <form onSubmit={handleSubmit} className="border border-amber-200 bg-amber-50/50 rounded-lg p-3 space-y-2">
      <p className="text-xs font-semibold text-amber-800">Invite associate (outside collaborator — project access only)</p>
      <div className="flex flex-col sm:flex-row gap-2">
        <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
          placeholder="Associate email" className="input flex-1" />
        <input required value={name} onChange={e => setName(e.target.value)}
          placeholder="Full name" className="input flex-1" />
        <button type="submit" disabled={busy}
          className="text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50 rounded-md px-3 py-2">
          {busy ? 'Inviting…' : 'Invite associate'}
        </button>
      </div>
      {msg && <p className={`text-sm ${msg.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>{msg.text}</p>}
    </form>
  )
}
```

- [ ] **Step 4: Run the form tests**

Run: `corepack pnpm vitest run src/features/projects/__tests__/InviteAssociateForm.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire it in**

`ProjectDetailPanel.tsx`: import `InviteAssociateForm`; render `<div className="mb-4"><InviteAssociateForm projectId={project.id} onInvited={() => void loadMembers()} /></div>` directly below the email-search block. In `RoleBadge`, give `role === 'Associate'` the classes `bg-amber-100 text-amber-800` (check it before the `canCreate` branch).

`ProjectPage.tsx`: import `InviteAssociateForm`; directly below the header row that contains the `canManage && <button … setShowCreate(true)>` (≈ line 280), render
`{user?.role === 'Admin' && <div className="mb-4"><InviteAssociateForm projectId={projectId!} onInvited={() => void loadMemberStatus()} /></div>}`.

Add to `ProjectDetailPanel.test.tsx` (role visibility block) a member row with `role: 'Associate'` and assert `screen.getByText('Associate')` is in the document.

- [ ] **Step 6: Verify and commit**

Run: `corepack pnpm tsc --noEmit && corepack pnpm vitest run`
Expected: tsc 0; all pass.

```bash
git add src/features/projects src/features/super-admin
git commit -m "feat: invite associates from the project panel and project page"
```

---

### Task 8: Associate app shell (sidebar, routing, bell)

**Files:**
- Modify: `src/features/auth/AuthContext.tsx` (`isAssociate`)
- Create: `src/features/notifications/NotificationsBell.tsx`
- Create: `src/features/projects/NoProjectsPage.tsx`
- Create: `src/app/AssociateLayout.tsx`
- Create: `src/app/__tests__/AssociateLayout.test.tsx`
- Modify: `src/app/Router.tsx:72-81` (`SmartRoot`)

**Interfaces:**
- Consumes: `useProjectMemberships()` → `{memberships: {id,name}[], loading}`; `notifIcon` (Task 4).
- Produces: `AuthContextValue.isAssociate: boolean`; `<AssociateLayout />`; `<NotificationsBell />`; `<NoProjectsPage />`.

- [ ] **Step 1: Write the failing layout tests**

```tsx
// src/app/__tests__/AssociateLayout.test.tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const membershipsMock = vi.fn()
vi.mock('@/hooks/useProjectMemberships', () => ({ useProjectMemberships: () => membershipsMock() }))
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'a1', name: 'Guest User', role: 'Associate' }, signOut: vi.fn() }),
}))
vi.mock('@/features/notifications/NotificationsBell', () => ({ NotificationsBell: () => <div>bell</div> }))

import { AssociateLayout } from '../AssociateLayout'

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<AssociateLayout />}>
          <Route index element={<div>time tracking</div>} />
          <Route path="leave" element={<div>leave page</div>} />
          <Route path="projects/:projectId" element={<div>project page</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

describe('AssociateLayout', () => {
  beforeEach(() => membershipsMock.mockReset())

  it('shows only project entries in the sidebar', () => {
    membershipsMock.mockReturnValue({ memberships: [{ id: 'p1', name: 'AMUSA' }], loading: false })
    renderAt('/projects/p1')
    expect(screen.getByText('PROJECTS-AMUSA')).toBeInTheDocument()
    expect(screen.queryByText('Time Tracking')).not.toBeInTheDocument()
    expect(screen.getByText('project page')).toBeInTheDocument()
  })

  it('redirects any non-project route to the first project', () => {
    membershipsMock.mockReturnValue({ memberships: [{ id: 'p1', name: 'AMUSA' }], loading: false })
    renderAt('/leave')
    expect(screen.queryByText('leave page')).not.toBeInTheDocument()
    expect(screen.getByText('project page')).toBeInTheDocument()
  })

  it('shows the no-projects page when they have no projects', () => {
    membershipsMock.mockReturnValue({ memberships: [], loading: false })
    renderAt('/')
    expect(screen.queryByText('time tracking')).not.toBeInTheDocument()
    expect(screen.getByText(/haven't been added to a project yet/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `corepack pnpm vitest run src/app/__tests__/AssociateLayout.test.tsx`
Expected: FAIL — cannot resolve `../AssociateLayout`.

- [ ] **Step 3: `isAssociate` in AuthContext**

Add `isAssociate: boolean` to `AuthContextValue` (after `isSuperAdmin`), compute after `effectiveUser` is resolved:
`const isAssociate = effectiveUser?.role === 'Associate'` and pass `isAssociate` in the provider value.

- [ ] **Step 4: NoProjectsPage and NotificationsBell**

```tsx
// src/features/projects/NoProjectsPage.tsx
export function NoProjectsPage() {
  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="max-w-sm text-center">
        <p className="text-4xl mb-3" aria-hidden="true">🗂</p>
        <h1 className="text-lg font-semibold text-gray-900 mb-1">You haven't been added to a project yet</h1>
        <p className="text-sm text-gray-500">Contact the person who invited you to DIGITRACKER.</p>
      </div>
    </div>
  )
}
```

```tsx
// src/features/notifications/NotificationsBell.tsx
import { useCallback, useEffect, useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import type { Notification } from '@/types'
import { notifIcon } from './notifIcon'

export function NotificationsBell() {
  const { user } = useAuth()
  const channelId = useId()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Notification[]>([])

  const load = useCallback(async () => {
    if (!user) return
    const { data } = await supabase.from('notifications').select('*')
      .eq('user_id', user.id).order('created_at', { ascending: false }).limit(20)
    setItems((data ?? []) as Notification[])
  }, [user])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!user) return
    const ch = supabase.channel(`notifications-bell:${channelId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` }, () => void load())
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [user, load, channelId])

  const unread = items.filter(n => !n.read).length

  async function markAllRead() {
    if (!user || unread === 0) return
    await supabase.from('notifications').update({ read: true }).eq('user_id', user.id).eq('read', false)
    setItems(prev => prev.map(n => ({ ...n, read: true })))
  }

  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)} aria-label={`Notifications (${unread} unread)`}
        className="relative w-10 h-10 rounded-full hover:bg-gray-100 flex items-center justify-center">
        <span aria-hidden="true">🔔</span>
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
            {unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] bg-white border border-gray-200 rounded-xl shadow-xl z-50">
          <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100">
            <p className="text-sm font-semibold text-gray-900">Notifications</p>
            <button onClick={() => void markAllRead()} className="text-xs text-violet-600 hover:text-violet-800">Mark all read</button>
          </div>
          <ul className="max-h-96 overflow-y-auto divide-y divide-gray-100">
            {items.length === 0 && <li className="px-4 py-6 text-sm text-gray-400 text-center">No notifications yet</li>}
            {items.map(n => (
              <li key={n.id} className={`px-4 py-3 text-sm flex gap-2 ${n.read ? 'text-gray-500' : 'text-gray-900 bg-violet-50/40'}`}>
                <span aria-hidden="true">{notifIcon(n.type)}</span>
                {n.project_id
                  ? <Link to={`/projects/${n.project_id}`} onClick={() => setOpen(false)} className="hover:underline">{n.message}</Link>
                  : <span>{n.message}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 5: AssociateLayout**

```tsx
// src/app/AssociateLayout.tsx
// App shell for associates (spec §2.3): project-only sidebar, no clock or
// time-tracking side effects, and every non-project route redirected.
import { NavLink, Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { useProjectMemberships } from '@/hooks/useProjectMemberships'
import { NotificationsBell } from '@/features/notifications/NotificationsBell'
import { NoProjectsPage } from '@/features/projects/NoProjectsPage'

const PROJECT_PATH = /^\/projects\/[^/]+$/

export function AssociateLayout() {
  const { user, signOut } = useAuth()
  const { memberships, loading } = useProjectMemberships()
  const location = useLocation()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-violet-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const onProjectRoute = PROJECT_PATH.test(location.pathname)
  if (!onProjectRoute && memberships.length > 0) {
    return <Navigate to={`/projects/${memberships[0].id}`} replace />
  }

  return (
    <div className="min-h-screen flex flex-col sm:flex-row bg-gray-50">
      <aside className="sm:w-64 bg-white border-b sm:border-b-0 sm:border-r border-gray-200 flex sm:flex-col">
        <nav aria-label="Projects" className="flex-1 px-3 py-3 sm:py-4 flex sm:flex-col gap-1 overflow-x-auto">
          {memberships.map(p => (
            <NavLink key={p.id} to={`/projects/${p.id}`}
              className={({ isActive }) => `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                isActive ? 'bg-violet-50 text-violet-700' : 'text-gray-600 hover:bg-gray-100'}`}
              style={{ minHeight: '44px' }}>
              <span aria-hidden="true">🗂</span>{`PROJECTS-${p.name}`}
            </NavLink>
          ))}
        </nav>
        <div className="px-3 py-3 sm:py-4 sm:border-t border-gray-100 flex sm:flex-col gap-1 flex-shrink-0">
          <p className="hidden sm:block px-3 text-sm font-medium truncate">{user?.name}</p>
          <p className="hidden sm:block px-3 text-xs text-gray-400 mb-1">Associate</p>
          <button onClick={() => void signOut()}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-red-500 hover:bg-red-50"
            style={{ minHeight: '44px' }}>
            <span aria-hidden="true">↪</span> Logout
          </button>
        </div>
      </aside>
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-end px-4 sm:px-6">
          <NotificationsBell />
        </header>
        <main className="flex-1 overflow-y-auto">
          {onProjectRoute ? <Outlet /> : <NoProjectsPage />}
        </main>
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Route associates to the new shell**

In `src/app/Router.tsx` import `AssociateLayout` and change `SmartRoot`:

```tsx
function SmartRoot() {
  const { user, loading, isAssociate } = useAuth()
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0d14]">
      <div className="w-8 h-8 border-4 border-violet-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )
  if (!user) return <LandingPage />
  return <AuthGuard>{isAssociate ? <AssociateLayout /> : <Layout />}</AuthGuard>
}
```

Note: `ProjectGuard` still wraps the project route, so an associate opening a project they're not in is redirected to `/`, which `AssociateLayout` then sends to their first project.

- [ ] **Step 7: Verify and commit**

Run: `corepack pnpm tsc --noEmit && corepack pnpm vitest run`
Expected: tsc 0 (update any test mocks of `useAuth` that TS now flags as missing `isAssociate` only if they're typed against `AuthContextValue`); all pass.

```bash
git add src/app src/features/auth/AuthContext.tsx src/features/notifications src/features/projects/NoProjectsPage.tsx
git commit -m "feat: associate app shell with project-only navigation and notifications bell"
```

---

### Task 9: Task modal behaviour for associates; no duplicate client notifications

**Files:**
- Modify: `src/features/projects/ProjectTaskDetailModal.tsx:53-54,75-96,119-127,212-241`
- Modify: `src/features/projects/CreateProjectTaskModal.tsx` (assignee notification loop)
- Create: `src/features/projects/__tests__/ProjectTaskDetailModal.associate.test.tsx`

**Interfaces:**
- Consumes: `members: User[]` with real `role` (Task 1); `useAuth().user.role`.
- Produces: helper `isAssociateMember(members: User[], id: string): boolean` exported from `src/features/projects/projectRoles.ts`.

- [ ] **Step 1: Read the modal's props and test harness needs**

Run: `sed -n 1,45p src/features/projects/ProjectTaskDetailModal.tsx`
Note the exact prop names (expected: `task`, `members`, `onClose`, `onUpdated`) and use them verbatim in the test below; adjust the test's props object if names differ.

- [ ] **Step 2: Write the failing tests**

```tsx
// src/features/projects/__tests__/ProjectTaskDetailModal.associate.test.tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ProjectTask, User } from '@/types'

let currentUser: Partial<User> = { id: 'a1', name: 'Guest', role: 'Associate' }
let assigneeRows: Array<{ user_id: string }> = []
const notificationsInsert = vi.fn().mockResolvedValue({ error: null })
const tasksUpdate = vi.fn()

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: currentUser }) }))
vi.mock('@/lib/supabase', () => {
  const chain = (result: unknown) => {
    const c: Record<string, unknown> = {}
    for (const k of ['select', 'eq', 'order']) c[k] = () => c
    c.then = (res: (v: unknown) => unknown) => Promise.resolve(result).then(res)
    return c
  }
  return {
    supabase: {
      from: (table: string) => {
        if (table === 'project_task_assignees') return chain({ data: assigneeRows })
        if (table === 'project_task_comments') return { ...chain({ data: [] }), insert: vi.fn().mockResolvedValue({ error: null }) }
        if (table === 'notifications') return { insert: notificationsInsert }
        if (table === 'project_tasks') return { update: (v: unknown) => { tasksUpdate(v); return { eq: () => Promise.resolve({ error: null }) } } }
        return chain({ data: [] })
      },
      channel: () => ({ on() { return this }, subscribe() { return this } }),
      removeChannel: vi.fn(),
      storage: { from: () => ({ upload: vi.fn(), createSignedUrl: vi.fn() }) },
    },
  }
})

import { ProjectTaskDetailModal } from '../ProjectTaskDetailModal'

const task = {
  id: 't1', project_id: 'p1', title: 'Design review', description: null, creator_id: 'admin1',
  assignee_id: null, status: 'pending', due_date: null, recurring: null, attachments: [], created_at: '2026-10-01T00:00:00Z',
} as ProjectTask
const members = [
  { id: 'admin1', name: 'Admin', role: 'Admin' },
  { id: 'a1', name: 'Guest', role: 'Associate' },
  { id: 'a2', name: 'Other Guest', role: 'Associate' },
] as User[]

function renderModal() {
  return render(<ProjectTaskDetailModal task={task} members={members} onClose={vi.fn()} onUpdated={vi.fn()} />)
}

describe('ProjectTaskDetailModal — associates', () => {
  beforeEach(() => {
    currentUser = { id: 'a1', name: 'Guest', role: 'Associate' }
    notificationsInsert.mockClear()
    tasksUpdate.mockClear()
  })

  it('hides Edit/Delete and status buttons on a task not assigned to the associate', async () => {
    assigneeRows = [{ user_id: 'admin1' }]
    renderModal()
    await waitFor(() => expect(screen.queryByText('Edit')).not.toBeInTheDocument())
    expect(screen.queryByText('Delete')).not.toBeInTheDocument()
    expect(screen.queryByText(/→/)).not.toBeInTheDocument()
    expect(screen.queryByText('Close')).not.toBeInTheDocument()
  })

  it('lets an assigned associate change status without inserting client-side notifications', async () => {
    assigneeRows = [{ user_id: 'a1' }]
    renderModal()
    await userEvent.click(await screen.findByText(/→/))
    expect(tasksUpdate).toHaveBeenCalledWith({ status: 'in_progress' })
    expect(notificationsInsert).not.toHaveBeenCalled()
  })

  it('a staff/admin status change does not client-notify associate assignees', async () => {
    currentUser = { id: 'admin1', name: 'Admin', role: 'Admin' }
    assigneeRows = [{ user_id: 'a2' }]
    renderModal()
    await userEvent.click(await screen.findByText(/→/))
    await waitFor(() => expect(tasksUpdate).toHaveBeenCalled())
    const targets = notificationsInsert.mock.calls.map(c => (c[0] as { user_id: string }).user_id)
    expect(targets).not.toContain('a2')
  })
})
```

- [ ] **Step 3: Run to verify failure**

Run: `corepack pnpm vitest run src/features/projects/__tests__/ProjectTaskDetailModal.associate.test.tsx`
Expected: FAIL — status buttons visible for the unassigned associate; notifications inserted.

- [ ] **Step 4: Implement**

```ts
// src/features/projects/projectRoles.ts
import type { User } from '@/types'

// Associates get project notifications from database triggers
// (20261006000300); client-side inserts must skip them to avoid duplicates —
// and associates themselves can't insert notifications at all.
export function isAssociateMember(members: User[], id: string): boolean {
  return members.find(m => m.id === id)?.role === 'Associate'
}
```

In `ProjectTaskDetailModal.tsx`:
- After `canManage`, add:
  ```ts
  const isAssociate = user?.role === 'Associate'
  const isAssigned = assigneeIds.includes(user?.id ?? '')
  const canChangeStatus = !isAssociate || isAssigned
  ```
  and change `canComment` to `canManage || isAssigned || isAssociate`. (`canManage` is already false for associates: they never match the role list and never create tasks.)
- Wrap the whole "Status progression buttons" `<div className="ml-auto …">…</div>` contents in `{canChangeStatus && (<>…</>)}`.
- In `updateStatus`, replace the notification block with:
  ```ts
  if (isAssociate) return
  const notifTargets = [...new Set([
    ...assigneeIds.filter(id => id !== user?.id),
    ...(status === 'completed' || status === 'closed' ? [task.creator_id].filter(id => id !== user?.id) : []),
  ])].filter(id => !isAssociateMember(members, id))
  ```
  (keep the existing `type` and insert loop below it).
- In `postComment`, after inserting the comment: `if (user.role === 'Associate')` skip the notification loop entirely; otherwise add `.filter(id => !isAssociateMember(members, id))` to `notifTargets`.

In `CreateProjectTaskModal.tsx`, the "Notify assignees" loop: change the condition to
`if (uid !== user.id && !isAssociateMember(pickable, uid))` and import `isAssociateMember`.

- [ ] **Step 5: Verify and commit**

Run: `corepack pnpm tsc --noEmit && corepack pnpm vitest run`
Expected: tsc 0; all pass.

```bash
git add src/features/projects
git commit -m "feat: associate-aware task modal permissions and no duplicate notifications"
```

---

### Task 10: Deploy and live verification

**Files:**
- Create: `scripts/verify-associate-lock.mjs` (manual verification; not run in CI)

**Interfaces:**
- Consumes: everything above, deployed.

- [ ] **Step 1: One-time secret setup (user action — ask the user; do not invent values)**

Ask the user to:
1. Generate a secret: `openssl rand -hex 32`.
2. Add it as GitHub repo secret `NOTIFICATION_EMAIL_SECRET` (repo Settings → Secrets → Actions).
3. In the Supabase SQL editor run: `select vault.create_secret('<same value>', 'notification_email_secret');`

Without these the dispatch trigger logs a warning and skips emails; nothing else breaks.

- [ ] **Step 2: Push and watch the deploy**

```bash
git checkout main && git merge --ff-only feat/project-associates && git push origin main
```
Poll `https://api.github.com/repos/amwellinc/digitracker/actions/runs?head_sha=<sha>` until `completed`; then list job steps. Expected: `frontend` and `supabase` jobs `success`, including "Apply database migrations" and "Deploy Edge Functions".

- [ ] **Step 3: Write the verification script**

```js
// scripts/verify-associate-lock.mjs
// Usage: SUPABASE_URL=... SUPABASE_ANON_KEY=... ASSOC_EMAIL=... ASSOC_PASSWORD=... \
//        PROJECT_ID=<their project> OTHER_PROJECT_ID=<not theirs> ASSIGNED_TASK_ID=... UNASSIGNED_TASK_ID=... \
//        node scripts/verify-associate-lock.mjs
import { createClient } from '@supabase/supabase-js'

const env = (k) => { const v = process.env[k]; if (!v) throw new Error(`${k} is required`); return v }
const sb = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'))
const { error: loginErr } = await sb.auth.signInWithPassword({ email: env('ASSOC_EMAIL'), password: env('ASSOC_PASSWORD') })
if (loginErr) throw loginErr

let failures = 0
const check = (label, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} ${detail}`); if (!ok) failures++ }

for (const table of ['time_logs', 'leave_requests', 'tasks', 'documents', 'payroll_entries', 'sub_accounts']) {
  const { data, error } = await sb.from(table).select('*').limit(1)
  check(`cannot read ${table}`, !!error || (data ?? []).length === 0, error?.message ?? '')
}
for (const rpc of ['get_team_status', 'debug_data_isolation', 'get_manager_downline']) {
  const { error } = await sb.rpc(rpc, {})
  check(`cannot call rpc ${rpc}`, !!error && /associates/i.test(error.message), error?.message ?? 'no error')
}
const own = await sb.from('projects').select('id').eq('id', env('PROJECT_ID'))
check('can read own project', (own.data ?? []).length === 1)
const other = await sb.from('projects').select('id').eq('id', env('OTHER_PROJECT_ID'))
check('cannot read other project', (other.data ?? []).length === 0)

const statusOk = await sb.from('project_tasks').update({ status: 'in_progress' }).eq('id', env('ASSIGNED_TASK_ID')).select('id')
check('can change status of assigned task', !statusOk.error && (statusOk.data ?? []).length === 1, statusOk.error?.message ?? '')
const titleBad = await sb.from('project_tasks').update({ title: 'hacked' }).eq('id', env('ASSIGNED_TASK_ID'))
check('cannot change title', !!titleBad.error, titleBad.error?.message ?? 'no error')
const unassigned = await sb.from('project_tasks').update({ status: 'in_progress' }).eq('id', env('UNASSIGNED_TASK_ID')).select('id')
check('cannot update unassigned task', !!unassigned.error || (unassigned.data ?? []).length === 0)
const ins = await sb.from('project_tasks').insert({ project_id: env('PROJECT_ID'), title: 'x', creator_id: '00000000-0000-0000-0000-000000000000' })
check('cannot create task', !!ins.error, ins.error?.message ?? 'no error')
const del = await sb.from('project_tasks').delete().eq('id', env('ASSIGNED_TASK_ID')).select('id')
check('cannot delete task', !!del.error || (del.data ?? []).length === 0)
const up = await sb.storage.from('task-attachments').upload(`${env('UNASSIGNED_TASK_ID')}-not-a-folder/x.txt`, new Blob(['x']))
check('cannot upload outside project task folders', !!up.error, up.error?.message ?? 'no error')

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed')
process.exit(failures ? 1 : 0)
```

- [ ] **Step 4: Live check with the user**

Ask the user (as Super-Admin) to:
1. Invite a test mailbox they control as an associate into a test project; confirm the sign-in email and the "added to project" email arrive.
2. Create one task assigned to the associate and one not. The script needs the associate's password: associates aren't in a workspace, so Settings → Users can't set one — have the associate use "Forgot password?" on the login page to set it.
3. Run as Super-Admin in the app console or SQL editor: `select * from public.associate_lock_gaps();` — expected 0 rows (any "row level security disabled" rows must be reported to the user before proceeding).
4. Run `scripts/verify-associate-lock.mjs` with the associate's credentials and the IDs above. Expected: `All checks passed`.
5. Move the associate's task to In Progress as the Admin; confirm the associate receives the 🔄 bell entry and an email.
6. Remove the associate from the project in Platform Admin → Projects; confirm they can no longer sign in (suspended message).

- [ ] **Step 5: Commit the script**

```bash
git add scripts/verify-associate-lock.mjs
git commit -m "test: add live verification script for the associate lock"
git push origin main
```
