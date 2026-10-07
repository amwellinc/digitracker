-- Migration 20261007010000: let any Admin reach projects their own
-- sub-account already participates in, even before they're personally
-- added as a member.
--
-- Previously, adding members to a project (and seeing it at all -- RLS on
-- projects/project_tasks/project_files/storage, the sidebar nav, and
-- ProjectGuard's route check all gate on is_project_member()) required the
-- caller to literally have their own row in project_members. In practice,
-- Super-Admin often adds a single Staff member to represent a sub-account
-- in a project; that sub-account's Admin -- who should naturally have
-- authority over their own team's participation -- had no way to add
-- anyone else, or even open the project, until someone personally added
-- them first.
--
-- is_project_member() is the single shared gate every one of those checks
-- already calls (projects_select, project_tasks/_assignees/_comments,
-- project_folders/_files, the storage.objects policies, and
-- add_project_member's own authorization), so broadening it here extends
-- full project access -- same as an actual member -- to a qualifying Admin
-- everywhere at once, with no other function needing a change.
--
-- Scope stays narrow: only role = 'Admin' (not Manager), and only for a
-- project where the Admin's OWN sub_account already has at least one
-- member. An Admin whose company has zero presence in a project still
-- correctly has none of these rights -- this cannot be used to make a
-- workspace participate in a project it was never added to; only to act
-- fully within one it already does.

create or replace function public.is_project_member(p_project_id uuid)
  returns boolean
  language sql security definer stable
as $$
  select exists (
    select 1 from public.project_members
    where project_id = p_project_id and user_id = public.auth_user_app_id()
  )
  or (
    public.auth_user_role() = 'Admin'
    and exists (
      select 1 from public.project_members pm
      join public.users u on u.id = pm.user_id
      where pm.project_id = p_project_id
        and u.sub_account = public.auth_user_sub_account()
    )
  )
$$;

-- project_members_select never called is_project_member() -- it only ever
-- let a caller see their own row -- so a qualifying Admin could pass every
-- check above yet still not see who else is already in the project (to
-- avoid duplicate adds, or just know their own team's roster there).
drop policy if exists "project_members_select" on public.project_members;
create policy "project_members_select" on public.project_members
  for select using (
    public.auth_user_role() = 'Super-Admin'
    or user_id = public.auth_user_app_id()
    or public.is_project_member(project_id)
  );

notify pgrst, 'reload schema';
