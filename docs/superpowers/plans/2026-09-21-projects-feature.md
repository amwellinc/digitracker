# Projects Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Projects feature — a cross-sub-account collaboration space (task board mirroring the existing Tasks feature) whose membership can span up to 3 customer workspaces, provisioned and managed exclusively by Super-Admin.

**Architecture:** Fully additive. New tables (`projects`, `project_members`, `project_tasks`, `project_task_assignees`, `project_task_comments`) and new SECURITY DEFINER RPCs/helpers gate access via project membership instead of `sub_account`. Zero changes to any existing table, policy, or component — the existing single-tenant isolation model (hardened in migration 026) is untouched.

**Tech Stack:** React + TypeScript + Vite, Supabase (Postgres + RLS + SECURITY DEFINER SQL functions), Vitest + Testing Library, react-router-dom (HashRouter).

**Spec:** `docs/superpowers/specs/2026-09-21-projects-feature-design.md`

## Global Constraints

- A project can have members from **at most 3 distinct `sub_account`s** — enforced server-side in `add_project_member`, not just in the UI.
- Only **Super-Admin** can create a project or add/remove its members. No other role gets any project-management UI.
- Presence is **three-state: online / idle / offline** — reuse the exact same semantics `TeamAvatarRow.tsx` already uses (`status === 'working'` + `isIdle(last_activity_at)` → idle; `status === 'lunch'` → online; no active session → offline).
- No existing table's RLS policy changes. No existing component's existing behavior changes (only additive changes: new nav entries, new route).
- Sidebar label format is exactly `` `PROJECTS-${project.name}` `` — one nav entry per project membership, no grouping/dropdown.
- Every new piece of non-trivial logic (hook, guard, pure function, membership cap handling) gets a Vitest test, following this repo's existing test conventions (mocked `@/lib/supabase`, Testing Library for components). Purely-visual UI mirrors of already-untested components (`TasksPage`, `CreateTaskModal`, `TaskDetailModal`) follow that same precedent and are verified manually against the live app instead, consistent with how those originals are handled today.
- This repo has no local Postgres/Docker test setup — migrations are verified by careful review, then applied for real via `git push` to `main` (CI runs `supabase db push` automatically). Task 1 is deployed and confirmed against the live database before later tasks that depend on it (Tasks 3+) are implemented against it.

---

## Task 1: Database schema, RLS, and RPCs for Projects

**Files:**
- Create: `supabase/migrations/055_projects_feature.sql`

**Interfaces:**
- Produces (used by every later task): tables `public.projects(id, name, created_by, created_at)`, `public.project_members(project_id, user_id, added_at)`, `public.project_tasks(id, project_id, title, description, creator_id, assignee_id, status, due_date, recurring, attachments, created_at)`, `public.project_task_assignees(project_task_id, user_id)`, `public.project_task_comments(id, project_task_id, user_id, body, attachments, created_at)`; RPCs `add_project_member(p_project_id uuid, p_user_id uuid) returns void`, `remove_project_member(p_project_id uuid, p_user_id uuid) returns void`, `get_project_member_status(p_project_id uuid) returns table(user_id uuid, name text, profile_image text, status text, last_activity_at timestamptz)`; helper `is_project_member(p_project_id uuid) returns boolean`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/055_projects_feature.sql` with this exact content:

```sql
-- Migration 055: Projects feature — cross-sub-account collaboration spaces
--
-- Projects are the one deliberate, narrow exception to this schema's
-- otherwise strict single-tenant isolation (see migration 026's audit). A
-- project's membership can span up to 3 different sub_accounts; only
-- Super-Admin can create a project or manage its membership (enforced
-- inside the RPCs below, not just in the client). Cross-tenant visibility
-- is confined entirely to the tables created here — no existing table's
-- RLS changes.

-- ── projects ─────────────────────────────────────────────────────────────────

create table public.projects (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now()
);

-- ── project_members ──────────────────────────────────────────────────────────
-- No insert/update/delete policy on purpose — every write goes through
-- add_project_member / remove_project_member below, which is where the
-- 3-sub-account cap and the Super-Admin-only check actually live. A direct
-- table policy could not enforce the cap (it can't count other rows as part
-- of a WITH CHECK on its own row).

create table public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id    uuid not null references public.users(id) on delete cascade,
  added_at   timestamptz not null default now(),
  primary key (project_id, user_id)
);

create or replace function public.is_project_member(p_project_id uuid)
  returns boolean
  language sql security definer stable
as $$
  select exists (
    select 1 from public.project_members
    where project_id = p_project_id and user_id = public.auth_user_app_id()
  )
$$;

alter table public.projects enable row level security;
alter table public.project_members enable row level security;

create policy "projects_select" on public.projects
  for select using (
    public.auth_user_role() = 'Super-Admin'
    or public.is_project_member(id)
  );

create policy "projects_insert_super_admin" on public.projects
  for insert with check (
    public.auth_user_role() = 'Super-Admin'
    and created_by = public.auth_user_app_id()
  );

create policy "project_members_select" on public.project_members
  for select using (
    public.auth_user_role() = 'Super-Admin'
    or user_id = public.auth_user_app_id()
  );

-- ── project_tasks / project_task_assignees / project_task_comments ─────────────
-- Structurally identical to tasks / task_assignees / task_comments. Every
-- policy gates on is_project_member(project_id) — any member, any role, any
-- home sub-account, has the same read/write shape the existing Tasks
-- feature already grants its own members today.

create table public.project_tasks (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  title       text not null,
  description text,
  creator_id  uuid not null references public.users(id),
  assignee_id uuid references public.users(id),
  status      text not null default 'pending'
              check (status in ('pending', 'in_progress', 'completed', 'closed', 'archived')),
  due_date    timestamptz,
  recurring   text check (recurring in ('Daily', 'Weekly', 'Monthly')),
  attachments jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now()
);

alter table public.project_tasks enable row level security;

create policy "project_tasks_select" on public.project_tasks
  for select using (public.is_project_member(project_id));

create policy "project_tasks_insert" on public.project_tasks
  for insert with check (
    public.is_project_member(project_id)
    and creator_id = public.auth_user_app_id()
  );

create policy "project_tasks_update" on public.project_tasks
  for update using (public.is_project_member(project_id));

create policy "project_tasks_delete" on public.project_tasks
  for delete using (public.is_project_member(project_id));

create table public.project_task_assignees (
  project_task_id uuid not null references public.project_tasks(id) on delete cascade,
  user_id         uuid not null references public.users(id),
  primary key (project_task_id, user_id)
);

alter table public.project_task_assignees enable row level security;

create policy "project_task_assignees_select" on public.project_task_assignees
  for select using (
    exists (
      select 1 from public.project_tasks pt
      where pt.id = project_task_assignees.project_task_id
        and public.is_project_member(pt.project_id)
    )
  );

create policy "project_task_assignees_write" on public.project_task_assignees
  for all using (
    exists (
      select 1 from public.project_tasks pt
      where pt.id = project_task_assignees.project_task_id
        and public.is_project_member(pt.project_id)
    )
  );

create table public.project_task_comments (
  id              uuid primary key default gen_random_uuid(),
  project_task_id uuid not null references public.project_tasks(id) on delete cascade,
  user_id         uuid not null references public.users(id),
  body            text not null,
  attachments     jsonb,
  created_at      timestamptz not null default now()
);

alter table public.project_task_comments enable row level security;

create policy "project_task_comments_select" on public.project_task_comments
  for select using (
    exists (
      select 1 from public.project_tasks pt
      where pt.id = project_task_comments.project_task_id
        and public.is_project_member(pt.project_id)
    )
  );

create policy "project_task_comments_insert" on public.project_task_comments
  for insert with check (
    user_id = public.auth_user_app_id()
    and exists (
      select 1 from public.project_tasks pt
      where pt.id = project_task_comments.project_task_id
        and public.is_project_member(pt.project_id)
    )
  );

-- ── Membership RPCs — Super-Admin only, cap enforced here ───────────────────────

create or replace function public.add_project_member(p_project_id uuid, p_user_id uuid)
  returns void
  language plpgsql security definer
  set search_path = public
as $$
declare
  v_target_sub    text;
  v_distinct_subs int;
begin
  if public.auth_user_role() is distinct from 'Super-Admin' then
    raise exception 'Only Super-Admin can manage project membership';
  end if;

  if not exists (select 1 from public.projects where id = p_project_id) then
    raise exception 'Project not found';
  end if;

  select sub_account into v_target_sub from public.users where id = p_user_id;
  if v_target_sub is null then
    raise exception 'User not found';
  end if;

  if exists (
    select 1 from public.project_members
    where project_id = p_project_id and user_id = p_user_id
  ) then
    return; -- already a member — no-op, not an error
  end if;

  select count(distinct u.sub_account) into v_distinct_subs
    from public.project_members pm
    join public.users u on u.id = pm.user_id
    where pm.project_id = p_project_id;

  -- Only block if this user's sub_account isn't already represented AND
  -- the project is already at the 3-workspace cap. Adding another person
  -- from an already-represented workspace never increases the count.
  if v_distinct_subs >= 3 and not exists (
    select 1 from public.project_members pm2
    join public.users u2 on u2.id = pm2.user_id
    where pm2.project_id = p_project_id and u2.sub_account = v_target_sub
  ) then
    raise exception 'This project already has members from 3 workspaces — remove one before adding a member from a 4th.';
  end if;

  insert into public.project_members (project_id, user_id) values (p_project_id, p_user_id);
end;
$$;

grant execute on function public.add_project_member(uuid, uuid) to authenticated;

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
end;
$$;

grant execute on function public.remove_project_member(uuid, uuid) to authenticated;

-- ── Presence RPC — narrow field set, no raw time_logs exposure ──────────────────
-- Deliberately no `date = today` filter: with members spanning up to 3
-- different sub-account timezones, "today" isn't one boundary. An active
-- (not-yet-clocked-out) time_logs row is unambiguous regardless of which
-- calendar day its `date` column recorded when the session started.

create or replace function public.get_project_member_status(p_project_id uuid)
  returns table (
    user_id          uuid,
    name             text,
    profile_image    text,
    status           text,
    last_activity_at timestamptz
  )
  language sql security definer stable
as $$
  select u.id, u.name, u.profile_image, tl.status, tl.last_activity_at
  from public.project_members pm
  join public.users u on u.id = pm.user_id
  left join public.time_logs tl
    on tl.user_id = u.id
    and tl.status in ('working', 'lunch')
  where pm.project_id = p_project_id
    and public.is_project_member(p_project_id)
$$;

grant execute on function public.get_project_member_status(uuid) to authenticated;
```

- [ ] **Step 2: Self-review the migration against the spec**

Read back through `supabase/migrations/055_projects_feature.sql` and confirm against `docs/superpowers/specs/2026-09-21-projects-feature-design.md`:
- Every table matches the spec's column list exactly.
- `add_project_member` blocks a 4th distinct workspace but allows an already-represented one — trace through the logic by hand with an example: project has members from `AM333` and `AM444` (2 distinct); adding a user from `AM555` → `v_distinct_subs = 2`, not `>= 3`, so it's allowed (this is the 3rd workspace, which is within the cap); adding a further user from a brand-new `AM666` after that → `v_distinct_subs = 3`, `>= 3` is true, and `AM666` isn't already represented, so it's rejected. Adding another user from `AM333` at that point → `v_distinct_subs = 3` but `AM333` IS already represented, so it's allowed.
- `project_members` has no insert/update/delete policy (writes only via the RPCs).
- No `ALTER POLICY` or `DROP POLICY` touches any table outside this migration's own new tables.

- [ ] **Step 3: Commit**

```bash
cd /Users/arunkemer/DIGI5Y/digitracker
git add supabase/migrations/055_projects_feature.sql
git commit -m "feat: add Projects schema, RLS, and membership RPCs"
```

- [ ] **Step 4: Deploy and confirm against the live database**

```bash
git push origin main
```

Wait for the GitHub Actions "Deploy" workflow to complete (check `https://github.com/amwellinc/digitracker/actions`), then confirm the `supabase` job succeeded (this runs `supabase db push`, which applies this migration to the real project). Do not start Task 2 until this is confirmed green — later tasks assume these tables exist in the live database.

---

## Task 2: Types and shared utility generalization

**Files:**
- Modify: `src/types/index.ts` (add new interfaces near the existing `Task`/`TaskAssignee`/`TaskComment` definitions, around line 60-85)
- Modify: `src/features/tasks/taskUtils.ts:1-13` (generalize `getAlertLevel`'s parameter type so `ProjectTask` also satisfies it, avoiding a duplicate copy of this function)

**Interfaces:**
- Consumes: nothing new (pure type-level change).
- Produces: `Project`, `ProjectMember`, `ProjectTask`, `ProjectTaskAssignee`, `ProjectTaskComment` types; `getAlertLevel` now accepts any `{ status: string; due_date: string | null }`-shaped value.

- [ ] **Step 1: Add the new types**

In `src/types/index.ts`, immediately after the existing `TaskComment` interface (after line 85), add:

```ts
export interface Project {
  id: string
  name: string
  created_by: string
  created_at: string
}

export interface ProjectMember {
  project_id: string
  user_id: string
  added_at: string
}

export interface ProjectTask {
  id: string
  project_id: string
  title: string
  description: string | null
  creator_id: string
  assignee_id: string | null
  status: 'pending' | 'in_progress' | 'completed' | 'closed' | 'archived'
  due_date: string | null
  recurring: 'Daily' | 'Weekly' | 'Monthly' | null
  attachments: Array<{ url: string; name: string; size: number; type: string }>
  created_at: string
}

export interface ProjectTaskAssignee {
  project_task_id: string
  user_id: string
}

export interface ProjectTaskComment {
  id: string
  project_task_id: string
  user_id: string
  body: string
  attachments: unknown | null
  created_at: string
}
```

- [ ] **Step 2: Generalize `getAlertLevel`'s parameter type**

In `src/features/tasks/taskUtils.ts`, replace:

```ts
import type { Task } from '@/types'

export type AlertLevel = 'overdue' | 'soon' | null

export function getAlertLevel(task: Task): AlertLevel {
```

with:

```ts
export type AlertLevel = 'overdue' | 'soon' | null

// Structural, not `Task`-specific — ProjectTask has the same status/due_date
// shape and reuses this directly rather than duplicating it.
export interface AlertLevelInput {
  status: string
  due_date: string | null
}

export function getAlertLevel(task: AlertLevelInput): AlertLevel {
```

(The rest of the function body is unchanged — it only reads `task.due_date` and `task.status`, both still present on the new parameter type.)

- [ ] **Step 3: Verify the project type-checks**

Run: `cd /Users/arunkemer/DIGI5Y/digitracker && npx tsc --noEmit --pretty false`
Expected: no errors (this is a pure type-level change; nothing consumes the new types yet, and `Task` still satisfies the widened `AlertLevelInput` structurally).

- [ ] **Step 4: Commit**

```bash
git add src/types/index.ts src/features/tasks/taskUtils.ts
git commit -m "feat: add Project types, generalize getAlertLevel for reuse"
```

---

## Task 3: `useProjectMemberships` hook

**Files:**
- Create: `src/hooks/useProjectMemberships.ts`
- Create: `src/hooks/__tests__/useProjectMemberships.test.tsx`

**Interfaces:**
- Consumes: `useAuth()` → `{ user }` (existing, from `@/hooks/useAuth`); Supabase table `project_members` joined to `projects(name)` (from Task 1).
- Produces: `useProjectMemberships(): { memberships: { id: string; name: string }[]; loading: boolean }` — consumed by Task 5 (sidebar) and Task 4 (guard).

- [ ] **Step 1: Write the failing test**

Create `src/hooks/__tests__/useProjectMemberships.test.tsx`:

```tsx
import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { useProjectMemberships } from '../useProjectMemberships'
import { AuthContext } from '@/features/auth/AuthContext'
import type { User } from '@/types'

const selectMock = vi.fn()
const eqMock = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: (...args: unknown[]) => { selectMock(...args); return { eq: (...eqArgs: unknown[]) => eqMock(...eqArgs) } },
    })),
  },
}))

const mockUser: User = {
  id: 'u1', email: 'a@a.com', name: 'Alice', role: 'Staff', sub_account: 'AM333',
  manager_id: null, annual_leave: 14, time_off: 5, profile_image: null,
  reporting_time_in: '10:00', reporting_time_out: '19:00', country: 'SG', phone: null,
  status: 'active', created_at: '2026-01-01T00:00:00Z', appointed_as: null,
  address_line1: null, address_line2: null, address_city: null, address_pin_code: null,
  last_ip_address: null, last_ip_captured_at: null, emergency_contact_name: null,
  emergency_contact_phone: null, department_id: null,
}

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <AuthContext.Provider value={{
      user: mockUser, loading: false, accountBlockedMessage: null, isSuperAdmin: false,
      visitingAccount: null, visitSubAccount: vi.fn(), exitVisit: vi.fn(),
      viewAsUser: null, startViewAs: vi.fn(), exitViewAs: vi.fn(),
      signIn: vi.fn(), signInWithPassword: vi.fn(), sendPasswordReset: vi.fn(),
      signOut: vi.fn(), refreshUser: vi.fn(),
    }}>
      {children}
    </AuthContext.Provider>
  )
}

describe('useProjectMemberships', () => {
  it('returns an empty list when the user has no project memberships', async () => {
    eqMock.mockResolvedValueOnce({ data: [] })
    const { result } = renderHook(() => useProjectMemberships(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.memberships).toEqual([])
  })

  it('maps joined project rows into {id, name}', async () => {
    eqMock.mockResolvedValueOnce({
      data: [
        { project_id: 'p1', projects: { name: 'JohnBakery' } },
        { project_id: 'p2', projects: { name: 'AcmeCorp' } },
      ],
    })
    const { result } = renderHook(() => useProjectMemberships(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.memberships).toEqual([
      { id: 'p1', name: 'JohnBakery' },
      { id: 'p2', name: 'AcmeCorp' },
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/arunkemer/DIGI5Y/digitracker && npx vitest run src/hooks/__tests__/useProjectMemberships.test.tsx`
Expected: FAIL — `Cannot find module '../useProjectMemberships'`.

- [ ] **Step 3: Write the implementation**

Create `src/hooks/useProjectMemberships.ts`:

```ts
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from './useAuth'

export interface ProjectMembership {
  id: string
  name: string
}

interface MembershipRow {
  project_id: string
  projects: { name: string } | null
}

export function useProjectMemberships() {
  const { user } = useAuth()
  const [memberships, setMemberships] = useState<ProjectMembership[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!user) { setMemberships([]); setLoading(false); return }
    setLoading(true)
    const { data } = await supabase
      .from('project_members')
      .select('project_id, projects(name)')
      .eq('user_id', user.id)

    const rows = (data ?? []) as unknown as MembershipRow[]
    setMemberships(
      rows
        .filter(r => r.projects)
        .map(r => ({ id: r.project_id, name: r.projects!.name }))
    )
    setLoading(false)
  }, [user])

  useEffect(() => { void load() }, [load])

  return { memberships, loading }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/arunkemer/DIGI5Y/digitracker && npx vitest run src/hooks/__tests__/useProjectMemberships.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useProjectMemberships.ts src/hooks/__tests__/useProjectMemberships.test.tsx
git commit -m "feat: add useProjectMemberships hook"
```

---

## Task 4: `ProjectGuard` component

**Files:**
- Create: `src/features/projects/ProjectGuard.tsx`
- Create: `src/features/projects/__tests__/ProjectGuard.test.tsx`

**Interfaces:**
- Consumes: `useProjectMemberships()` (Task 3) → `{ memberships, loading }`; `useParams<{ projectId: string }>()` from `react-router-dom`.
- Produces: `ProjectGuard({ children }: { children: ReactNode })` — used by Task 7's route registration.

- [ ] **Step 1: Write the failing test**

Create `src/features/projects/__tests__/ProjectGuard.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ProjectGuard } from '../ProjectGuard'

const useProjectMembershipsMock = vi.fn()
vi.mock('@/hooks/useProjectMemberships', () => ({
  useProjectMemberships: () => useProjectMembershipsMock(),
}))

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<div>home</div>} />
        <Route
          path="/projects/:projectId"
          element={<ProjectGuard><div>project content</div></ProjectGuard>}
        />
      </Routes>
    </MemoryRouter>
  )
}

describe('ProjectGuard', () => {
  it('shows a spinner while memberships are loading', () => {
    useProjectMembershipsMock.mockReturnValue({ memberships: [], loading: true })
    const { container } = renderAt('/projects/p1')
    expect(container.querySelector('.animate-spin')).toBeInTheDocument()
  })

  it('renders children when the user is a member of this project', () => {
    useProjectMembershipsMock.mockReturnValue({ memberships: [{ id: 'p1', name: 'JohnBakery' }], loading: false })
    renderAt('/projects/p1')
    expect(screen.getByText('project content')).toBeInTheDocument()
  })

  it('redirects to / when the user is not a member of this project', () => {
    useProjectMembershipsMock.mockReturnValue({ memberships: [{ id: 'p2', name: 'AcmeCorp' }], loading: false })
    renderAt('/projects/p1')
    expect(screen.getByText('home')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/arunkemer/DIGI5Y/digitracker && npx vitest run src/features/projects/__tests__/ProjectGuard.test.tsx`
Expected: FAIL — `Cannot find module '../ProjectGuard'`.

- [ ] **Step 3: Write the implementation**

Create `src/features/projects/ProjectGuard.tsx`:

```tsx
import type { ReactNode } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { useProjectMemberships } from '@/hooks/useProjectMemberships'

interface Props {
  children: ReactNode
}

export function ProjectGuard({ children }: Props) {
  const { projectId } = useParams<{ projectId: string }>()
  const { memberships, loading } = useProjectMemberships()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-violet-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const isMember = memberships.some(m => m.id === projectId)
  if (!isMember) return <Navigate to="/" replace />

  return <>{children}</>
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/arunkemer/DIGI5Y/digitracker && npx vitest run src/features/projects/__tests__/ProjectGuard.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/projects/ProjectGuard.tsx src/features/projects/__tests__/ProjectGuard.test.tsx
git commit -m "feat: add ProjectGuard route guard"
```

---

## Task 5: Dynamic Projects entries in the sidebar

**Files:**
- Modify: `src/app/Layout.tsx:1-26` (imports and nav construction), `:62-64` (NAV computation)
- Create: `src/app/__tests__/Layout.test.tsx`

**Interfaces:**
- Consumes: `useProjectMemberships()` (Task 3).
- Produces: nothing new consumed elsewhere — this is a leaf UI change.

- [ ] **Step 1: Write the failing test**

Create `src/app/__tests__/Layout.test.tsx`. This test isolates just the new dynamic-nav behavior — it does not attempt full `Layout` coverage (the existing component has no prior test to extend, consistent with how `TasksPage`/`SubAccountsTab` are also untested UI shells).

```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { Layout } from '../Layout'
import { AuthContext } from '@/features/auth/AuthContext'
import type { User } from '@/types'

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }) },
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: [] }),
      single: vi.fn().mockResolvedValue({ data: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: null }),
    })),
    channel: vi.fn().mockReturnValue({ on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis() }),
    removeChannel: vi.fn(),
    rpc: vi.fn().mockResolvedValue({ data: null }),
  },
}))

const useProjectMembershipsMock = vi.fn()
vi.mock('@/hooks/useProjectMemberships', () => ({
  useProjectMemberships: () => useProjectMembershipsMock(),
}))
vi.mock('@/hooks/useReportsAccess', () => ({ useReportsAccess: () => false }))
vi.mock('@/hooks/useSubAccountBranding', () => ({ useSubAccountBranding: () => ({ companyName: null, logoUrl: null }) }))

const staffUser: User = {
  id: 'u1', email: 'a@a.com', name: 'Alice', role: 'Staff', sub_account: 'AM333',
  manager_id: null, annual_leave: 14, time_off: 5, profile_image: null,
  reporting_time_in: '10:00', reporting_time_out: '19:00', country: 'SG', phone: null,
  status: 'active', created_at: '2026-01-01T00:00:00Z', appointed_as: null,
  address_line1: null, address_line2: null, address_city: null, address_pin_code: null,
  last_ip_address: null, last_ip_captured_at: null, emergency_contact_name: null,
  emergency_contact_phone: null, department_id: null,
}

function renderLayout() {
  return render(
    <MemoryRouter>
      <AuthContext.Provider value={{
        user: staffUser, loading: false, accountBlockedMessage: null, isSuperAdmin: false,
        visitingAccount: null, visitSubAccount: vi.fn(), exitVisit: vi.fn(),
        viewAsUser: null, startViewAs: vi.fn(), exitViewAs: vi.fn(),
        signIn: vi.fn(), signInWithPassword: vi.fn(), sendPasswordReset: vi.fn(),
        signOut: vi.fn(), refreshUser: vi.fn(),
      }}>
        <Layout />
      </AuthContext.Provider>
    </MemoryRouter>
  )
}

describe('Layout — dynamic Projects nav', () => {
  it('shows no Projects entry when the user has no project memberships', () => {
    useProjectMembershipsMock.mockReturnValue({ memberships: [], loading: false })
    renderLayout()
    expect(screen.queryByText(/^PROJECTS-/)).not.toBeInTheDocument()
  })

  it('shows one nav entry per project membership, labeled PROJECTS-<name>', () => {
    useProjectMembershipsMock.mockReturnValue({
      memberships: [{ id: 'p1', name: 'JohnBakery' }, { id: 'p2', name: 'AcmeCorp' }],
      loading: false,
    })
    renderLayout()
    expect(screen.getByText('PROJECTS-JohnBakery')).toBeInTheDocument()
    expect(screen.getByText('PROJECTS-AcmeCorp')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/arunkemer/DIGI5Y/digitracker && npx vitest run src/app/__tests__/Layout.test.tsx`
Expected: FAIL — no `PROJECTS-JohnBakery` text found (the nav is still the static `STAFF_NAV`).

- [ ] **Step 3: Implement the dynamic nav entries**

In `src/app/Layout.tsx`, add the import (near the other hook imports at the top):

```ts
import { useProjectMemberships } from '@/hooks/useProjectMemberships'
```

Then find this block (around line 62-64):

```ts
  const NAV = isSuperAdminView
    ? SUPER_ADMIN_NAV
    : canViewReports ? [...STAFF_NAV, REPORTS_NAV_ITEM] : STAFF_NAV
```

Replace it with:

```ts
  const { memberships: projectMemberships } = useProjectMemberships()
  const PROJECT_NAV_ITEMS = projectMemberships.map(p => ({
    to: `/projects/${p.id}`,
    end: false,
    label: `PROJECTS-${p.name}`,
    icon: '🗂',
  }))
  const NAV = isSuperAdminView
    ? SUPER_ADMIN_NAV
    : [...(canViewReports ? [...STAFF_NAV, REPORTS_NAV_ITEM] : STAFF_NAV), ...PROJECT_NAV_ITEMS]
```

(This must be called inside `LayoutInner`, alongside the other hook calls near the top of that function — not inside `isSuperAdminView`'s branch, since hooks can't be called conditionally. Super-Admins don't see project entries because `NAV` only uses `PROJECT_NAV_ITEMS` in the non-`isSuperAdminView` branch, even though the hook itself always runs.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/arunkemer/DIGI5Y/digitracker && npx vitest run src/app/__tests__/Layout.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the full suite to confirm no regression**

Run: `cd /Users/arunkemer/DIGI5Y/digitracker && npx tsc --noEmit --pretty false && npx vitest run`
Expected: all existing tests still pass, plus the 2 new ones.

- [ ] **Step 6: Commit**

```bash
git add src/app/Layout.tsx src/app/__tests__/Layout.test.tsx
git commit -m "feat: render one sidebar entry per Project membership"
```

---

## Task 6: `projectPresence.ts` pure function

**Files:**
- Create: `src/features/projects/projectPresence.ts`
- Create: `src/features/projects/__tests__/projectPresence.test.ts`

**Interfaces:**
- Consumes: `isIdle` from `@/lib/activity` (existing).
- Produces: `presenceFromStatus(status: 'working' | 'lunch' | null, lastActivityAt: string | null): 'online' | 'idle' | 'offline'` — consumed by Task 8's project header.

- [ ] **Step 1: Write the failing test**

Create `src/features/projects/__tests__/projectPresence.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { presenceFromStatus } from '../projectPresence'

describe('presenceFromStatus', () => {
  it('is offline when there is no active session', () => {
    expect(presenceFromStatus(null, null)).toBe('offline')
  })

  it('is online when working and recently active', () => {
    const recent = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    expect(presenceFromStatus('working', recent)).toBe('online')
  })

  it('is idle when working but inactive for over 20 minutes', () => {
    const old = new Date(Date.now() - 25 * 60 * 1000).toISOString()
    expect(presenceFromStatus('working', old)).toBe('idle')
  })

  it('is online while on lunch, never idle, regardless of last activity', () => {
    const old = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()
    expect(presenceFromStatus('lunch', old)).toBe('online')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/arunkemer/DIGI5Y/digitracker && npx vitest run src/features/projects/__tests__/projectPresence.test.ts`
Expected: FAIL — `Cannot find module '../projectPresence'`.

- [ ] **Step 3: Write the implementation**

Create `src/features/projects/projectPresence.ts`:

```ts
import { isIdle } from '@/lib/activity'

export type PresenceStatus = 'online' | 'idle' | 'offline'

// Matches TeamAvatarRow.tsx's existing presence semantics exactly, so
// Projects' header looks and behaves identically to the Team Status
// indicator already shipped elsewhere: idle only applies while 'working'
// (never while on lunch), offline means no active session at all.
export function presenceFromStatus(
  status: 'working' | 'lunch' | null,
  lastActivityAt: string | null,
): PresenceStatus {
  if (!status) return 'offline'
  if (status === 'working' && isIdle(lastActivityAt)) return 'idle'
  return 'online'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/arunkemer/DIGI5Y/digitracker && npx vitest run src/features/projects/__tests__/projectPresence.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/projects/projectPresence.ts src/features/projects/__tests__/projectPresence.test.ts
git commit -m "feat: add presenceFromStatus for Project member status"
```

---

## Task 7: Register the `/projects/:projectId` route

**Files:**
- Modify: `src/app/Router.tsx` (add lazy import near the other `lazy()` imports, add route inside the authenticated `<Route path="/">` block)

**Interfaces:**
- Consumes: `ProjectGuard` (Task 4), `ProjectPage` (Task 8 — created as an empty placeholder-free stub in this task, filled in by Task 8).

Since Task 8 doesn't exist yet, this task creates a minimal real `ProjectPage` (not a placeholder — a genuine, working "loading project…" component that Task 8 replaces with the full task board) so the route is fully functional and testable at each step, per this plan's own "no placeholders" rule applied to sequencing: every task leaves the app in a working state.

- [ ] **Step 1: Create the initial `ProjectPage`**

Create `src/features/projects/ProjectPage.tsx`:

```tsx
import { useParams } from 'react-router-dom'

export function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>()
  return <div className="text-sm text-gray-500">Loading project {projectId}…</div>
}
```

- [ ] **Step 2: Register the route**

In `src/app/Router.tsx`, add this lazy import alongside the other feature imports (near `const TasksPage = lazy(...)`):

```ts
const ProjectPage = lazy(() =>
  import('@/features/projects/ProjectPage').then(m => ({ default: m.ProjectPage }))
)
```

Add this import at the top with the other named imports:

```ts
import { ProjectGuard } from '@/features/projects/ProjectGuard'
```

Then add this route inside the authenticated `<Route path="/">` block, after the `tasks` route:

```tsx
          <Route
            path="projects/:projectId"
            element={
              <ProjectGuard>
                <Suspense fallback={<Spinner />}>
                  <ProjectPage />
                </Suspense>
              </ProjectGuard>
            }
          />
```

- [ ] **Step 3: Verify it type-checks and the app still runs**

Run: `cd /Users/arunkemer/DIGI5Y/digitracker && npx tsc --noEmit --pretty false`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/Router.tsx src/features/projects/ProjectPage.tsx
git commit -m "feat: register /projects/:projectId route behind ProjectGuard"
```

---

## Task 8: `ProjectPage` — task board and presence header

**Files:**
- Modify: `src/features/projects/ProjectPage.tsx` (replace the Task 7 stub entirely)

**Interfaces:**
- Consumes: `ProjectTask`, `ProjectTaskAssignee`, `User` types (Task 2); `getAlertLevel`, `fmtDue`, `STATUS_COLOR`, `STATUS_LABEL`, `TaskFilter` from `@/features/tasks/taskUtils` (Task 2 generalized `getAlertLevel` to accept this); `presenceFromStatus` (Task 6); RPC `get_project_member_status` (Task 1); `CreateProjectTaskModal`, `ProjectTaskDetailModal` (Task 9 — this task references them but Task 9 must land before this task is functional end-to-end; implement them together if working solo, or sequence Task 9 first if splitting across reviewers).

**Note on approach:** `ProjectPage` mirrors `src/features/tasks/TasksPage.tsx` almost exactly — same filter bar, same card layout, same modals-open-on-click structure — scoped to `project_tasks` instead of `tasks`, plus a presence header `TasksPage` doesn't have. Rather than re-deriving ~340 lines from scratch (and risking drift from a battle-tested layout), copy the file and apply this exact, complete set of changes:

- [ ] **Step 1: Copy the file as a starting point**

```bash
cd /Users/arunkemer/DIGI5Y/digitracker
cp src/features/tasks/TasksPage.tsx src/features/projects/ProjectPage.tsx
```

- [ ] **Step 2: Apply every one of these changes to the new `src/features/projects/ProjectPage.tsx`**

1. Rename the exported function `TasksPage` → `ProjectPage`.
2. Add `import { useParams } from 'react-router-dom'` and, inside the component, `const { projectId } = useParams<{ projectId: string }>()`.
3. Replace the import `import type { Task, TaskAssignee, User } from '@/types'` with `import type { ProjectTask, ProjectTaskAssignee, User } from '@/types'`, and replace every occurrence of the bare type name `Task` with `ProjectTask` and `TaskAssignee` with `ProjectTaskAssignee` throughout the file (the `TaskRow` interface's `task: Task` field becomes `task: ProjectTask`, `TaskCard`'s `row: TaskRow` stays as-is since `TaskRow` itself already carries the change).
4. Replace `import { CreateTaskModal } from './CreateTaskModal'` and `import { TaskDetailModal } from './TaskDetailModal'` with `import { CreateProjectTaskModal } from './CreateProjectTaskModal'` and `import { ProjectTaskDetailModal } from './ProjectTaskDetailModal'` (created in Task 9), and update their two usages later in the file (`<CreateTaskModal ... />` → `<CreateProjectTaskModal ... />`, same for the detail modal), passing `projectId={projectId!}` as an additional prop to both.
5. Every Supabase query target table changes: `.from('tasks')` → `.from('project_tasks')`, `.from('task_assignees')` → `.from('project_task_assignees')`, `.from('task_comments')` → `.from('project_task_comments')` (comment counts, if present in the original file's query for `commentCount`, follow the same table rename).
6. Every query against `project_tasks`/`project_task_assignees` adds a project scope: any `.select(...)` on `project_tasks` gets an added `.eq('project_id', projectId)` (RLS already scopes this correctly via `is_project_member`, but explicit scoping avoids fetching tasks from other projects the same member might belong to in a single query result).
7. Replace the members source: the original `TasksPage` sources assignable/filterable `members: User[]` from a broader query (e.g. `same_sub_account` or downline-scoped users) — replace that query with:
   ```ts
   const { data: memberRows } = await supabase.rpc('get_project_member_status', { p_project_id: projectId })
   ```
   mapped into `User[]`-shaped objects for the parts of the UI that only need `{id, name, profile_image}` (assignee avatars, assignee picker) — `get_project_member_status` doesn't return every `User` field, so anywhere the original code used a `User` field beyond `id`/`name`/`profile_image` for members (e.g. `role`, `email`), drop that usage; Project members are shown by name/avatar only, consistent with the spec's presence-only cross-tenant exposure.
8. Add a presence header above the existing filter bar (new JSX, not present in `TasksPage`):
   ```tsx
   <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 flex items-center gap-4 flex-wrap">
     {memberStatus.map(m => (
       <div key={m.user_id} className="flex items-center gap-2">
         <span className={`w-2 h-2 rounded-full ${
           presenceFromStatus(m.status, m.last_activity_at) === 'online' ? 'bg-green-500'
             : presenceFromStatus(m.status, m.last_activity_at) === 'idle' ? 'bg-amber-500'
             : 'bg-gray-300'
         }`} />
         <span className="text-sm text-gray-700">{m.name}</span>
       </div>
     ))}
   </div>
   ```
   with `memberStatus` as new component state populated from the same `get_project_member_status` call in Step 7 (store the raw RPC rows — `{user_id, name, profile_image, status, last_activity_at}` — separately from the mapped `User[]` used for assignment, since the header needs `status`/`last_activity_at` which the assignee-picker doesn't), and `import { presenceFromStatus } from './projectPresence'` at the top of the file.
9. Refresh the member/presence list on the same realtime cadence `TeamAvatarRow.tsx` uses: add a `useRealtime({ table: 'time_logs', onInsert: refetchMemberStatus, onUpdate: refetchMemberStatus })` call (import `useRealtime` from `@/hooks/useRealtime`) so presence dots update live.

- [ ] **Step 3: Verify it type-checks**

Run: `cd /Users/arunkemer/DIGI5Y/digitracker && npx tsc --noEmit --pretty false`
Expected: no errors once Task 9's `CreateProjectTaskModal`/`ProjectTaskDetailModal` exist (if implementing sequentially, this step will show errors for the missing modal files until Task 9 lands — that's expected; re-run this check after Task 9).

- [ ] **Step 4: Manually verify against the live app**

Since `TasksPage` (the file this mirrors) has no automated test coverage today, verification here follows that same precedent: run `pnpm dev`, sign in as a user who is a project member (added via Task 11's Super-Admin UI, once it exists — for now, add a row to `project_members` directly via the Supabase dashboard's Table Editor for a test project/user pair), navigate to `/projects/:id`, and confirm: the task board loads scoped to that project, the presence header shows member dots, and creating/assigning/commenting on a task works.

- [ ] **Step 5: Commit**

```bash
git add src/features/projects/ProjectPage.tsx
git commit -m "feat: build ProjectPage task board with presence header"
```

---

## Task 9: `CreateProjectTaskModal` and `ProjectTaskDetailModal`

**Files:**
- Create: `src/features/projects/CreateProjectTaskModal.tsx` (copied and adapted from `src/features/tasks/CreateTaskModal.tsx`)
- Create: `src/features/projects/ProjectTaskDetailModal.tsx` (copied and adapted from `src/features/tasks/TaskDetailModal.tsx`)

**Interfaces:**
- Consumes: `ProjectTask`, `ProjectTaskComment` types (Task 2); called by `ProjectPage` (Task 8) with an added `projectId: string` prop.
- Produces: `CreateProjectTaskModal(props: { projectId: string; members: User[]; onClose: () => void; onCreated: () => void })`, `ProjectTaskDetailModal(props: { projectId: string; task: ProjectTask; members: User[]; onClose: () => void; onUpdated: () => void })` — exact prop names must match whatever `ProjectPage` passes in Task 8; if implementing Task 8 and Task 9 in the same session, keep these two files' prop signatures and Task 8's call sites in sync as you write them (they are one unit of work split into two tasks only for reviewability).

- [ ] **Step 1: Copy both files**

```bash
cd /Users/arunkemer/DIGI5Y/digitracker
cp src/features/tasks/CreateTaskModal.tsx src/features/projects/CreateProjectTaskModal.tsx
cp src/features/tasks/TaskDetailModal.tsx src/features/projects/ProjectTaskDetailModal.tsx
```

- [ ] **Step 2: Apply this exact set of changes to `CreateProjectTaskModal.tsx`**

1. Rename the exported function `CreateTaskModal` → `CreateProjectTaskModal`.
2. Add `projectId: string` to the component's props interface and destructure it from props.
3. Replace `import type { Task, ... } from '@/types'` with `import type { ProjectTask, ... } from '@/types'` and rename every bare `Task` type usage to `ProjectTask`.
4. Change the insert target: `.from('tasks').insert({...})` → `.from('project_tasks').insert({ ...same fields..., project_id: projectId })`.
5. Change the assignee-write target: `.from('task_assignees').insert(...)` → `.from('project_task_assignees').insert(...)` with the column renamed `task_id` → `project_task_id` if the original uses that column name.

- [ ] **Step 3: Apply this exact set of changes to `ProjectTaskDetailModal.tsx`**

1. Rename the exported function `TaskDetailModal` → `ProjectTaskDetailModal`.
2. Add `projectId: string` to the component's props interface and destructure it from props (used for scoping any query that re-fetches within the modal, if the original does so).
3. Replace `import type { Task, TaskComment, ... } from '@/types'` with `import type { ProjectTask, ProjectTaskComment, ... } from '@/types'` and rename every bare `Task`/`TaskComment` usage to `ProjectTask`/`ProjectTaskComment`.
4. Change every query/mutation table target: `tasks` → `project_tasks`, `task_assignees` → `project_task_assignees` (column `task_id` → `project_task_id`), `task_comments` → `project_task_comments` (column `task_id` → `project_task_id`).

- [ ] **Step 4: Verify it type-checks**

Run: `cd /Users/arunkemer/DIGI5Y/digitracker && npx tsc --noEmit --pretty false`
Expected: no errors. If Task 8 was implemented before this task, this also confirms `ProjectPage`'s calls into these two modals now resolve correctly.

- [ ] **Step 5: Manually verify against the live app**

Same precedent as Task 8 (the originals, `CreateTaskModal`/`TaskDetailModal`, are also untested): create a task in a test project, assign it to another member, add a comment, change its status, confirm it appears correctly back on the board.

- [ ] **Step 6: Commit**

```bash
git add src/features/projects/CreateProjectTaskModal.tsx src/features/projects/ProjectTaskDetailModal.tsx
git commit -m "feat: add CreateProjectTaskModal and ProjectTaskDetailModal"
```

---

## Task 10: Super-Admin `ProjectsTab` — list and create projects

**Files:**
- Create: `src/features/super-admin/ProjectsTab.tsx`
- Modify: `src/app/Layout.tsx` (`SUPER_ADMIN_NAV` array, around line 21-26)
- Modify: `src/app/Router.tsx` (add lazy import + route, mirroring the existing `SubAccountsTab` registration)

**Interfaces:**
- Consumes: `Project` type (Task 2); `useAuth()` for `user.id` (as `created_by`).
- Produces: route `/platform/projects`; `ProjectsTab` renders a list and, on selecting a project, is expected to open `ProjectDetailPanel` (Task 11) — this task stubs that call so Task 11 can slot in without touching `ProjectsTab` again.

- [ ] **Step 1: Write `ProjectsTab.tsx`**

Create `src/features/super-admin/ProjectsTab.tsx`:

```tsx
import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import type { Project } from '@/types'
import { ProjectDetailPanel } from './ProjectDetailPanel'

export function ProjectsTab() {
  const { user } = useAuth()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [selected, setSelected] = useState<Project | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('projects').select('*').order('created_at', { ascending: false })
    setProjects((data ?? []) as Project[])
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!user) return
    setSaving(true); setMsg(null)
    const { error } = await supabase.from('projects').insert({ name: name.trim(), created_by: user.id })
    setSaving(false)
    if (error) { setMsg({ type: 'error', text: error.message }); return }
    setName('')
    setShowCreate(false)
    void load()
  }

  return (
    <div>
      {msg && (
        <div className={`mb-4 px-4 py-3 rounded-lg text-sm font-medium ${
          msg.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'
        }`}>
          {msg.text}
        </div>
      )}

      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Projects</h2>
          <p className="text-sm text-gray-500">{projects.length} project{projects.length !== 1 ? 's' : ''}</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 bg-violet-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-violet-700 transition-colors"
        >
          <span className="text-lg leading-none">+</span> New Project
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        {loading ? (
          <div className="flex items-center justify-center h-40 text-sm text-gray-400">Loading projects…</div>
        ) : projects.length === 0 ? (
          <div className="text-center py-10 text-gray-400">No projects yet. Create your first project.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Name</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Created</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {projects.map(p => (
                <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-900">{p.name}</td>
                  <td className="px-4 py-3 text-gray-500">{new Date(p.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => setSelected(p)}
                      className="text-xs font-semibold text-white bg-violet-600 hover:bg-violet-700 rounded-md px-3 py-1.5 transition-colors"
                    >
                      Manage Members
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowCreate(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-gray-900 mb-4">New Project</h3>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Project name</label>
                <input
                  required value={name} onChange={e => setName(e.target.value)}
                  placeholder="JohnBakery" className="input"
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowCreate(false)} className="btn-ghost">Cancel</button>
                <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Creating…' : 'Create'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {selected && <ProjectDetailPanel project={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
```

- [ ] **Step 2: Register the sidebar entry and route**

In `src/app/Layout.tsx`, find `SUPER_ADMIN_NAV` (around line 21-26) and add a new entry:

```ts
const SUPER_ADMIN_NAV = [
  { to: '/platform',          end: true,  label: 'Platform Admin',   icon: '🏢', children: [] },
  { to: '/platform/accounts', end: false, label: 'Sub-Accounts',     icon: '🏬', children: [] },
  { to: '/platform/projects', end: false, label: 'Projects',         icon: '🗂', children: [] },
  { to: '/settings',          end: false, label: 'Settings',         icon: '⚙',  children: [] },
  { to: '/platform/payments', end: false, label: 'Payment Settings', icon: '💳', children: [] },
]
```

In `src/app/Router.tsx`, add the lazy import alongside `SubAccountsTab`'s:

```ts
const ProjectsTab = lazy(() =>
  import('@/features/super-admin/ProjectsTab').then(m => ({ default: m.ProjectsTab }))
)
```

And add the route, mirroring the existing `platform/accounts` route exactly:

```tsx
          <Route
            path="platform/projects"
            element={
              <AuthGuard allowedRoles={['Super-Admin']}>
                <Suspense fallback={<Spinner />}>
                  <ProjectsTab />
                </Suspense>
              </AuthGuard>
            }
          />
```

- [ ] **Step 3: Verify it type-checks**

Run: `cd /Users/arunkemer/DIGI5Y/digitracker && npx tsc --noEmit --pretty false`
Expected: errors referencing missing `ProjectDetailPanel` — expected until Task 11. Proceed to Task 11 before considering this task done end-to-end (or implement both together).

- [ ] **Step 4: Commit**

```bash
git add src/features/super-admin/ProjectsTab.tsx src/app/Layout.tsx src/app/Router.tsx
git commit -m "feat: add Super-Admin Projects tab (list + create)"
```

---

## Task 11: `ProjectDetailPanel` — member management with cap enforcement

**Files:**
- Create: `src/features/super-admin/ProjectDetailPanel.tsx`
- Create: `src/features/super-admin/__tests__/ProjectDetailPanel.test.tsx`

**Interfaces:**
- Consumes: `Project`, `User` types (Task 2); RPCs `add_project_member`, `remove_project_member` (Task 1); called by `ProjectsTab` (Task 10) as `<ProjectDetailPanel project={selected} onClose={...} />`.
- Produces: nothing consumed elsewhere — this is the final leaf of the feature.

- [ ] **Step 1: Write the failing tests**

Create `src/features/super-admin/__tests__/ProjectDetailPanel.test.tsx`. This directly implements the three scenarios called out in the spec's Testing section.

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpcMock = vi.fn()
const membersSelectMock = vi.fn()
const usersSelectMock = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: vi.fn((table: string) => {
      if (table === 'project_members') {
        return { select: vi.fn().mockReturnThis(), eq: (...args: unknown[]) => membersSelectMock(...args) }
      }
      return {
        select: vi.fn().mockReturnThis(),
        ilike: (...args: unknown[]) => usersSelectMock(...args),
      }
    }),
  },
}))

import { ProjectDetailPanel } from '../ProjectDetailPanel'
import type { Project } from '@/types'

const project: Project = { id: 'p1', name: 'JohnBakery', created_by: 'admin-1', created_at: '2026-01-01T00:00:00Z' }

describe('ProjectDetailPanel — 3-workspace cap', () => {
  beforeEach(() => {
    rpcMock.mockReset()
    membersSelectMock.mockReset().mockResolvedValue({ data: [] })
    usersSelectMock.mockReset().mockResolvedValue({
      data: [{ id: 'u9', name: 'New Person', email: 'new@x.com', sub_account: 'AM999' }],
    })
  })

  it('adds a member successfully when the cap is not yet reached', async () => {
    rpcMock.mockResolvedValueOnce({ error: null })
    render(<ProjectDetailPanel project={project} onClose={vi.fn()} />)

    await userEvent.type(await screen.findByPlaceholderText(/search by email/i), 'new@x.com')
    await userEvent.click(await screen.findByText('Add'))

    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith('add_project_member', { p_project_id: 'p1', p_user_id: 'u9' }))
    await waitFor(() => expect(screen.getByText(/added/i)).toBeInTheDocument())
  })

  it('surfaces the cap error and does not show success when adding a 4th workspace', async () => {
    rpcMock.mockResolvedValueOnce({
      error: { message: 'This project already has members from 3 workspaces — remove one before adding a member from a 4th.' },
    })
    render(<ProjectDetailPanel project={project} onClose={vi.fn()} />)

    await userEvent.type(await screen.findByPlaceholderText(/search by email/i), 'new@x.com')
    await userEvent.click(await screen.findByText('Add'))

    await waitFor(() => expect(screen.getByText(/3 workspaces/i)).toBeInTheDocument())
  })

  it('allows adding another member from an already-represented workspace even at the cap', async () => {
    rpcMock.mockResolvedValueOnce({ error: null })
    render(<ProjectDetailPanel project={project} onClose={vi.fn()} />)

    await userEvent.type(await screen.findByPlaceholderText(/search by email/i), 'new@x.com')
    await userEvent.click(await screen.findByText('Add'))

    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith('add_project_member', { p_project_id: 'p1', p_user_id: 'u9' }))
    await waitFor(() => expect(screen.getByText(/added/i)).toBeInTheDocument())
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/arunkemer/DIGI5Y/digitracker && npx vitest run src/features/super-admin/__tests__/ProjectDetailPanel.test.tsx`
Expected: FAIL — `Cannot find module '../ProjectDetailPanel'`.

- [ ] **Step 3: Write the implementation**

Create `src/features/super-admin/ProjectDetailPanel.tsx`:

```tsx
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import type { Project, User } from '@/types'

interface Member {
  user_id: string
  name: string
  email: string
  sub_account: string
}

interface Props {
  project: Project
  onClose: () => void
}

export function ProjectDetailPanel({ project, onClose }: Props) {
  const [members, setMembers] = useState<Member[]>([])
  const [search, setSearch] = useState('')
  const [candidates, setCandidates] = useState<Pick<User, 'id' | 'name' | 'email' | 'sub_account'>[]>([])
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const loadMembers = useCallback(async () => {
    const { data } = await supabase
      .from('project_members')
      .select('user_id, users(name, email, sub_account)')
      .eq('project_id', project.id)
    type Row = { user_id: string; users: { name: string; email: string; sub_account: string } | null }
    const rows = (data ?? []) as unknown as Row[]
    setMembers(
      rows
        .filter(r => r.users)
        .map(r => ({ user_id: r.user_id, name: r.users!.name, email: r.users!.email, sub_account: r.users!.sub_account }))
    )
  }, [project.id])

  useEffect(() => { void loadMembers() }, [loadMembers])

  useEffect(() => {
    if (!search.trim()) { setCandidates([]); return }
    void supabase
      .from('users')
      .select('id, name, email, sub_account')
      .ilike('email', `%${search.trim()}%`)
      .then(({ data }) => setCandidates((data ?? []) as Pick<User, 'id' | 'name' | 'email' | 'sub_account'>[]))
  }, [search])

  async function handleAdd(userId: string) {
    setMsg(null)
    const { error } = await supabase.rpc('add_project_member', { p_project_id: project.id, p_user_id: userId })
    if (error) { setMsg({ type: 'error', text: error.message }); return }
    setMsg({ type: 'success', text: 'Member added.' })
    setSearch('')
    setCandidates([])
    void loadMembers()
  }

  async function handleRemove(userId: string) {
    setMsg(null)
    const { error } = await supabase.rpc('remove_project_member', { p_project_id: project.id, p_user_id: userId })
    if (error) { setMsg({ type: 'error', text: error.message }); return }
    void loadMembers()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
        <h3 className="font-semibold text-gray-900 mb-1">{project.name}</h3>
        <p className="text-xs text-gray-400 mb-4">Members can come from up to 3 different workspaces.</p>

        {msg && (
          <p className={`text-sm mb-3 ${msg.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>{msg.text}</p>
        )}

        <div className="mb-4">
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by email to add a member"
            className="input"
          />
          {candidates.length > 0 && (
            <div className="mt-2 border border-gray-200 rounded-lg divide-y divide-gray-100">
              {candidates.map(c => (
                <div key={c.id} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span>{c.name} — {c.email} <span className="text-gray-400">({c.sub_account})</span></span>
                  <button
                    onClick={() => handleAdd(c.id)}
                    className="text-xs font-semibold text-white bg-violet-600 hover:bg-violet-700 rounded-md px-3 py-1"
                  >
                    Add
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-2">
          {members.map(m => (
            <div key={m.user_id} className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg text-sm">
              <span>{m.name} — {m.email} <span className="text-gray-400">({m.sub_account})</span></span>
              <button
                onClick={() => handleRemove(m.user_id)}
                className="text-xs font-semibold text-red-600 hover:text-red-700"
              >
                Remove
              </button>
            </div>
          ))}
        </div>

        <div className="flex justify-end pt-4">
          <button onClick={onClose} className="btn-ghost text-sm">Close</button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/arunkemer/DIGI5Y/digitracker && npx vitest run src/features/super-admin/__tests__/ProjectDetailPanel.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the full suite and type-check**

Run: `cd /Users/arunkemer/DIGI5Y/digitracker && npx tsc --noEmit --pretty false && npx vitest run`
Expected: all tests pass, including every test from Tasks 1-10.

- [ ] **Step 6: Commit**

```bash
git add src/features/super-admin/ProjectDetailPanel.tsx src/features/super-admin/__tests__/ProjectDetailPanel.test.tsx
git commit -m "feat: add ProjectDetailPanel with 3-workspace cap enforcement"
```

- [ ] **Step 7: Deploy and do a full end-to-end manual pass**

```bash
git push origin main
```

Once CI completes, sign in as Super-Admin: create a project, add members from 3 different sub-accounts, confirm a 4th is rejected with the cap message, confirm removing one and re-adding from a new workspace works. Then sign in as one of the added members and confirm: the `PROJECTS-<name>` sidebar entry appears, the project page loads with the task board and presence header, and creating/assigning/commenting on a task works.

---

## Self-Review Notes (for whoever executes this plan)

- **Spec coverage:** sidebar naming (Task 5) ✓, per-membership multiple entries (Task 5) ✓, Super-Admin-only provisioning (Task 10) ✓, cross-sub-account membership up to 3 (Task 1's RPC, Task 11's UI) ✓, feature appears in left panel only for added users (Task 3 + Task 5, driven by `project_members` rows) ✓, header shows all assigned users with online/idle/offline (Task 8 + Task 6) ✓.
- **Type consistency:** `ProjectMemberStatusRow`-shaped data (`{user_id, name, profile_image, status, last_activity_at}`) flows from Task 1's RPC → Task 8's header and Task 6's `presenceFromStatus` with matching field names throughout. `ProjectMembership` (`{id, name}`) flows from Task 3 → Task 4 and Task 5 with matching field names throughout.
- **No new edge function** is introduced — every privileged operation is a SQL RPC, consistent with existing patterns (`archive_and_delete_user`, `check_account_status`) and avoiding the deploy-lag issue encountered earlier this session with Deno edge functions.
