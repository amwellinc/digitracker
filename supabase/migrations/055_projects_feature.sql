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
