-- Add work calendar timezone to sub_accounts.
-- Admins can set the IANA timezone for their workspace;
-- all calendar "today" logic follows this setting.

alter table public.sub_accounts
  add column if not exists timezone text not null default 'Asia/Singapore';

-- Allow any authenticated user in the sub-account to read its row (needed to fetch timezone)
drop policy if exists "sub_accounts_select_own" on public.sub_accounts;
create policy "sub_accounts_select_own" on public.sub_accounts
  for select using (code = public.auth_user_sub_account());

-- Allow Admin of the sub-account to update its timezone
drop policy if exists "sub_accounts_update_admin" on public.sub_accounts;
create policy "sub_accounts_update_admin" on public.sub_accounts
  for update using (
    code = public.auth_user_sub_account()
    and exists (
      select 1 from public.users
      where id = auth.uid() and role in ('Admin', 'Super-Admin')
    )
  )
  with check (
    code = public.auth_user_sub_account()
    and exists (
      select 1 from public.users
      where id = auth.uid() and role in ('Admin', 'Super-Admin')
    )
  );
