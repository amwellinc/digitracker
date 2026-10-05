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
