-- Migration 048: force-reassert RLS on payroll_entries and user_bank_details,
-- and add a live diagnostic to confirm it's actually enforced.
--
-- Live incident: an Admin logged into one sub-account (AMWELL USA) reported
-- seeing payroll entries belonging to users in a completely different
-- sub-account (AM333) who don't exist in their org. PayrollTab.tsx's fetch
-- for Admin/Manager has no client-side sub-account filter at all — by
-- design (see migration 029's own comment), it relies entirely on RLS as
-- the only real boundary. The policies in 029/030 read as correct in
-- isolation, but both tables share one unusual trait: they were originally
-- created directly against the live database (commit 640f327), outside any
-- tracked migration. That is exactly the kind of history where a later
-- migration can be silently skipped or a table's actual live state can
-- diverge from what its migration file says — "ALTER TABLE ... ENABLE ROW
-- LEVEL SECURITY" or a policy either never actually landed, or was reverted
-- by some out-of-band change, without anything in this repo's history
-- showing it.
--
-- Rather than guess further from the file history, this migration:
--   1. Re-enables RLS and re-creates every policy from 029/030 verbatim,
--      idempotently — this is a no-op if they were already correct, and a
--      real fix if either had silently drifted.
--   2. Adds a SECURITY INVOKER diagnostic the caller can run to see, under
--      their own real session and real RLS, exactly which sub-accounts'
--      data they can currently read from these two tables — so the fix can
--      be confirmed working from evidence, not assumed.

-- ── payroll_entries: re-assert exactly as migration 029 ────────────────────

alter table public.payroll_entries enable row level security;

drop policy if exists "payroll_entries_select" on public.payroll_entries;
drop policy if exists "payroll_entries_insert" on public.payroll_entries;
drop policy if exists "payroll_entries_delete" on public.payroll_entries;

create policy "payroll_entries_select" on public.payroll_entries
  for select using (
    user_id = public.auth_user_app_id()
    or public.auth_user_role() = 'Super-Admin'
    or (public.auth_user_role() = 'Admin' and public.same_sub_account_as_caller(user_id::text))
    or (public.auth_user_role() = 'Manager' and public.is_in_caller_downline(user_id))
  );

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

-- ── user_bank_details: re-assert exactly as migration 030 ──────────────────

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

-- ── Diagnostic: what can I actually see right now? ──────────────────────────
-- SECURITY INVOKER so RLS applies exactly as it does for the real app
-- request — this reports ground truth, not a reproduction of intent.

create or replace function public.debug_data_isolation()
  returns jsonb
  language plpgsql security invoker stable
as $$
declare
  my_role text := public.auth_user_role();
  my_sub  text := public.auth_user_sub_account();
  payroll_subs jsonb;
  bank_subs jsonb;
begin
  select coalesce(jsonb_agg(distinct u.sub_account), '[]'::jsonb)
    into payroll_subs
    from public.payroll_entries p
    join public.users u on u.id = p.user_id;

  select coalesce(jsonb_agg(distinct u.sub_account), '[]'::jsonb)
    into bank_subs
    from public.user_bank_details b
    join public.users u on u.id = b.user_id;

  return jsonb_build_object(
    'my_role', my_role,
    'my_sub_account', my_sub,
    'payroll_entries_visible_sub_accounts', payroll_subs,
    'user_bank_details_visible_sub_accounts', bank_subs
  );
end;
$$;

grant execute on function public.debug_data_isolation() to authenticated;

notify pgrst, 'reload schema';
