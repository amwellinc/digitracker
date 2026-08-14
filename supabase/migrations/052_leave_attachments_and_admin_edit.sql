-- Migration 052: Leave request attachments (medical certificates etc.) and
-- the storage bucket backing them.
--
-- No RLS change needed on leave_requests itself for either the "Admin can
-- edit an existing request" or "Admin can backdate" requirements — both
-- were already permitted by the existing leaves_update/leave_insert_own
-- policies (027), which never restricted which columns can change or what
-- date values are allowed. Those were purely client-side UI gaps
-- (RequestLeaveModal had no edit mode, and both date inputs had
-- min={today()} unconditionally). This migration only adds what was
-- actually missing at the data layer: somewhere to attach a document.
--
-- The bucket is private, scoped the same way leave_requests visibility
-- already is (self, Admin same sub-account, Manager own downline,
-- Super-Admin) — deliberately not the tighter HR-documents pattern (which
-- excludes Manager), since whoever can already see/edit a given leave
-- request should also be able to see and attach its supporting document;
-- a stricter attachment policy would make Manager able to edit a leave
-- request's dates but not view the MC attached to it.

alter table public.leave_requests add column if not exists attachments jsonb not null default '[]'::jsonb;

insert into storage.buckets (id, name, public)
values ('leave-documents', 'leave-documents', false)
on conflict (id) do nothing;

drop policy if exists "leave_documents_upload" on storage.objects;
drop policy if exists "leave_documents_read"   on storage.objects;
drop policy if exists "leave_documents_delete" on storage.objects;

create policy "leave_documents_upload" on storage.objects
  for insert with check (
    bucket_id = 'leave-documents'
    and (
      public.auth_user_app_id()::text = (storage.foldername(name))[1]
      or public.auth_user_role() = 'Super-Admin'
      or (public.auth_user_role() = 'Admin' and public.same_sub_account_as_caller((storage.foldername(name))[1]))
      or (public.auth_user_role() = 'Manager' and public.is_in_caller_downline((storage.foldername(name))[1]))
    )
  );

create policy "leave_documents_read" on storage.objects
  for select using (
    bucket_id = 'leave-documents'
    and (
      public.auth_user_app_id()::text = (storage.foldername(name))[1]
      or public.auth_user_role() = 'Super-Admin'
      or (public.auth_user_role() = 'Admin' and public.same_sub_account_as_caller((storage.foldername(name))[1]))
      or (public.auth_user_role() = 'Manager' and public.is_in_caller_downline((storage.foldername(name))[1]))
    )
  );

create policy "leave_documents_delete" on storage.objects
  for delete using (
    bucket_id = 'leave-documents'
    and (
      public.auth_user_app_id()::text = (storage.foldername(name))[1]
      or public.auth_user_role() = 'Super-Admin'
      or (public.auth_user_role() = 'Admin' and public.same_sub_account_as_caller((storage.foldername(name))[1]))
      or (public.auth_user_role() = 'Manager' and public.is_in_caller_downline((storage.foldername(name))[1]))
    )
  );

notify pgrst, 'reload schema';
