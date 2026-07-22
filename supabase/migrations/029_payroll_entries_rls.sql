-- Migration 029: payroll_entries RLS.
--
-- This table was never added through a tracked migration in this repo (it
-- was created directly against the live database in commit 640f327, "feat:
-- bank details tab, payroll tab" — the migration files that should have
-- shipped alongside it never did). That means there is no record of what
-- protections, if any, currently exist. PayrollTab.tsx only filters by
-- user_id client-side for non-managers (`if (!isManager) q.eq('user_id', ...)`)
-- — that is a UX convenience, not security; anyone can bypass a client-side
-- filter with a direct API call. RLS is the only real boundary here, and it
-- was unverifiable, which for salary data is not an acceptable unknown.
--
-- Written defensively regardless of the table's actual current state:
-- CREATE TABLE IF NOT EXISTS is a no-op against the existing table (and its
-- column/FK-constraint names match exactly what PayrollTab.tsx already
-- queries successfully, so this is purely a safety net, not a real create).
-- Every policy is dropped and recreated from scratch so the end state is
-- known-correct no matter what was there before.

create table if not exists public.payroll_entries (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.users(id) on delete cascade,
  payment_date   date not null,
  description    text not null,
  amount         numeric not null check (amount > 0),
  currency       text not null default 'SGD',
  payment_mode   text not null default 'Bank Transfer',
  created_by     uuid references public.users(id) on delete set null,
  created_at     timestamptz not null default now()
);

create index if not exists payroll_entries_user_date_idx
  on public.payroll_entries (user_id, payment_date desc);

alter table public.payroll_entries enable row level security;

drop policy if exists "payroll_entries_select" on public.payroll_entries;
drop policy if exists "payroll_entries_insert" on public.payroll_entries;
drop policy if exists "payroll_entries_delete" on public.payroll_entries;

-- A user always sees their own entries; Admin/Manager see their scoped team's
-- (same sub-account / downline, matching every other table this session);
-- Super-Admin unrestricted.
create policy "payroll_entries_select" on public.payroll_entries
  for select using (
    user_id = public.auth_user_app_id()
    or public.auth_user_role() = 'Super-Admin'
    or (public.auth_user_role() = 'Admin' and public.same_sub_account_as_caller(user_id::text))
    or (public.auth_user_role() = 'Manager' and public.is_in_caller_downline(user_id))
  );

-- Only Admin/Manager/Super-Admin add entries (matches the UI — the "Add
-- Entry" form never renders for Staff), scoped the same way, and — since
-- this is a write on someone else's behalf — the target must still be active.
create policy "payroll_entries_insert" on public.payroll_entries
  for insert with check (
    public.auth_user_role() = 'Super-Admin'
    or (
      public.auth_user_role() = 'Admin'
      and public.same_sub_account_as_caller(user_id::text)
      and public.target_user_is_active(user_id)
    )
    or (
      public.auth_user_role() = 'Manager'
      and public.is_in_caller_downline(user_id)
      and public.target_user_is_active(user_id)
    )
  );

create policy "payroll_entries_delete" on public.payroll_entries
  for delete using (
    public.auth_user_role() = 'Super-Admin'
    or (public.auth_user_role() = 'Admin' and public.same_sub_account_as_caller(user_id::text))
    or (public.auth_user_role() = 'Manager' and public.is_in_caller_downline(user_id))
  );
