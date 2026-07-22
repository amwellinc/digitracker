-- Migration 030: user_bank_details RLS.
--
-- Same unverifiable-state problem as payroll_entries (migration 029): this
-- table was created directly against the live database in commit 640f327
-- with no accompanying migration, so its actual RLS state was unknown.
-- BankDetailsTab.tsx only ever queried `.eq('user_id', user.id)` — again a
-- UX convenience, not a security boundary.
--
-- Scope, per explicit instruction: visible to the account's own user AND
-- Admin (same sub-account) ONLY — no Manager access, unlike payroll. Only
-- the account holder can create/edit their own bank details; an Admin's
-- access is read-only, since letting someone else silently change another
-- person's bank account number is exactly the kind of mistake that sends a
-- paycheck to the wrong place.
--
-- Written defensively regardless of the table's actual current state, same
-- as 029: CREATE TABLE IF NOT EXISTS is a no-op against the existing table;
-- every policy is dropped and recreated so the end state is known-correct.

create table if not exists public.user_bank_details (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.users(id) on delete cascade,
  bank_name      text not null default '',
  account_name   text not null default '',
  account_number text not null default '',
  bank_location  text not null default '',
  ifsc_iban_code text not null default '',
  swift_code     text not null default '',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

alter table public.user_bank_details enable row level security;

drop policy if exists "user_bank_details_select" on public.user_bank_details;
drop policy if exists "user_bank_details_insert" on public.user_bank_details;
drop policy if exists "user_bank_details_update" on public.user_bank_details;

create policy "user_bank_details_select" on public.user_bank_details
  for select using (
    user_id = public.auth_user_app_id()
    or public.auth_user_role() = 'Super-Admin'
    or (public.auth_user_role() = 'Admin' and public.same_sub_account_as_caller(user_id::text))
  );

create policy "user_bank_details_insert" on public.user_bank_details
  for insert with check (user_id = public.auth_user_app_id());

create policy "user_bank_details_update" on public.user_bank_details
  for update using (user_id = public.auth_user_app_id())
  with check (user_id = public.auth_user_app_id());
