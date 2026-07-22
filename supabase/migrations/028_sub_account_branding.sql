-- Migration 028: Sub-account branding — company name (already existed) + logo.
--
-- Lets a sub-account's Admin upload a logo and set a company name that
-- replaces the hardcoded "DIGITRACKER" title in the app header for everyone
-- in that workspace — simple white-label branding.
--
-- Also fixes sub_accounts_update_admin: it used auth.uid() directly, the
-- same class of bug fixed everywhere else this project touches RLS — an
-- Admin created via the admin UI (users.id != auth.uid()) could silently
-- fail to update their own sub_account row (timezone, and now branding).

alter table public.sub_accounts
  add column if not exists logo_url text;

drop policy if exists "sub_accounts_update_admin" on public.sub_accounts;

create policy "sub_accounts_update_admin" on public.sub_accounts
  for update using (
    code = public.auth_user_sub_account()
    and public.auth_user_role() in ('Admin', 'Super-Admin')
  )
  with check (
    code = public.auth_user_sub_account()
    and public.auth_user_role() in ('Admin', 'Super-Admin')
  );

-- Logo files live in the existing 'avatars' bucket (already publicly
-- readable with no path restriction) under _branding/<sub_account>/, mirroring
-- the _archive/<sub_account>/ convention used for employee archive files.
drop policy if exists "branding_logo_upload" on storage.objects;

create policy "branding_logo_upload" on storage.objects
  for insert with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = '_branding'
    and public.auth_user_role() in ('Admin', 'Super-Admin')
    and (storage.foldername(name))[2] = public.auth_user_sub_account()
  );
