-- Migration 025: Re-apply correct HR documents RLS + scope Admin/Manager
-- access to their own sub-account.
--
-- Root cause: documents (table) and storage.objects (documents bucket)
-- policies were last touched in migration 014 but, matching the same
-- class of drift migration 019 had to re-fix for time_logs, the live
-- policies no longer matched that file — Admin uploads/reads for another
-- user in the same workspace were failing with "new row violates row-level
-- security policy" (reported for cecillia@amwelltechnologies.com managing
-- dr.adnan@amwellinc.com's documents).
--
-- This also closes a real gap in the 014 version: "Admin/Manager" access
-- was granted by role alone, with no check that the target user is in the
-- caller's own sub-account — meaning an Admin in one workspace could read
-- or write another workspace's HR documents. The new policies require
-- Admin/Manager to be Admin/Manager of the *same* sub-account as the
-- target user (regardless of manager_id / reporting-line hierarchy, which
-- was never enforced here and still isn't — this is a sub-account
-- boundary, not a hierarchy one). Super-Admin (platform admin) remains
-- unrestricted.

-- ── Helper functions (idempotent re-create) ──────────────────────────────────

create or replace function public.auth_user_app_id()
  returns uuid
  language sql security definer stable
as $$
  select id from public.users where lower(email) = lower(auth.email())
$$;

create or replace function public.auth_user_role()
  returns text
  language sql security definer stable
as $$
  select role from public.users where lower(email) = lower(auth.email())
$$;

create or replace function public.auth_user_sub_account()
  returns text
  language sql security definer stable
as $$
  select sub_account from public.users where lower(email) = lower(auth.email())
$$;

-- Whether the caller (matched by JWT email) is in the same sub_account as
-- the given target user id. Accepts text so it can be called directly with
-- the raw storage.foldername() path segment as well as a uuid column cast
-- to text — returns false (never throws) for a malformed/unknown id so a
-- stray non-uuid folder name can't error out an unrelated policy check.
create or replace function public.same_sub_account_as_caller(target_user_id text)
  returns boolean
  language plpgsql security definer stable
as $$
declare
  caller_sub text;
  target_sub text;
begin
  select sub_account into caller_sub from public.users where lower(email) = lower(auth.email());
  if caller_sub is null then
    return false;
  end if;

  begin
    select sub_account into target_sub from public.users where id = target_user_id::uuid;
  exception when others then
    return false;
  end;

  return target_sub is not null and target_sub = caller_sub;
end;
$$;

-- ── documents (DB table) ──────────────────────────────────────────────────────

drop policy if exists "documents_select" on public.documents;
drop policy if exists "documents_insert" on public.documents;
drop policy if exists "documents_delete" on public.documents;

create policy "documents_select" on public.documents
  for select using (
    user_id = public.auth_user_app_id()
    or public.auth_user_role() = 'Super-Admin'
    or (
      public.auth_user_role() in ('Admin', 'Manager')
      and public.same_sub_account_as_caller(user_id::text)
    )
  );

create policy "documents_insert" on public.documents
  for insert with check (
    user_id = public.auth_user_app_id()
    or public.auth_user_role() = 'Super-Admin'
    or (
      public.auth_user_role() in ('Admin', 'Manager')
      and public.same_sub_account_as_caller(user_id::text)
    )
  );

create policy "documents_delete" on public.documents
  for delete using (
    user_id = public.auth_user_app_id()
    or public.auth_user_role() = 'Super-Admin'
    or (
      public.auth_user_role() = 'Admin'
      and public.same_sub_account_as_caller(user_id::text)
    )
  );

-- ── storage.objects — documents bucket ────────────────────────────────────────

drop policy if exists "documents_upload" on storage.objects;
drop policy if exists "documents_read"   on storage.objects;
drop policy if exists "documents_delete" on storage.objects;

create policy "documents_upload" on storage.objects
  for insert with check (
    bucket_id = 'documents'
    and (
      public.auth_user_app_id()::text = (storage.foldername(name))[1]
      or public.auth_user_role() = 'Super-Admin'
      or (
        public.auth_user_role() in ('Admin', 'Manager')
        and public.same_sub_account_as_caller((storage.foldername(name))[1])
      )
    )
  );

create policy "documents_read" on storage.objects
  for select using (
    bucket_id = 'documents'
    and (
      public.auth_user_app_id()::text = (storage.foldername(name))[1]
      or public.auth_user_role() = 'Super-Admin'
      or (
        public.auth_user_role() in ('Admin', 'Manager')
        and public.same_sub_account_as_caller((storage.foldername(name))[1])
      )
    )
  );

create policy "documents_delete" on storage.objects
  for delete using (
    bucket_id = 'documents'
    and (
      public.auth_user_app_id()::text = (storage.foldername(name))[1]
      or public.auth_user_role() = 'Super-Admin'
      or (
        public.auth_user_role() = 'Admin'
        and public.same_sub_account_as_caller((storage.foldername(name))[1])
      )
    )
  );
