-- Migration 051: New leave types, Admin leave balance adjustments, and a
-- pre-existing gap fix for leave cancellation.
--
-- 1. Two new leave_requests types: 'PH/Off-in-Lieu' (compensatory day for
--    working a public holiday) and 'Other' (free-form, with a required
--    short label stored in the new other_type_label column — distinct from
--    the general "reason" field, which stays about *why*, not *what kind*).
--
-- 2. leave_adjustments: an Admin-only credit/debit ledger against a user's
--    leave balance, with a required remark. Annual Leave and Time-off
--    already have a directly-editable entitlement number in Users & Roles
--    (UsersTab), and Medical is a fixed constant — this ledger *adds* an
--    audited, remarked adjustment on top of whichever base a type has
--    (zero, for the two new types), rather than replacing those existing
--    fields. "When a leave request is approved, the user's leave is
--    adjusted" falls out of the existing balance math for free: remaining
--    = (base + net adjustments) − sum(approved requests of that type) —
--    approval already reduces "used", so once adjustments are folded into
--    "total" on the client, no separate debit-on-approval step is needed.
--
-- 3. leaves_delete: there has never been a DELETE policy on leave_requests
--    at all (confirmed against every migration that's touched this table).
--    RLS denies-by-default per command, so MyLeaveTab's "Cancel" button on
--    a pending request has always silently deleted zero rows — no error,
--    since an RLS-filtered DELETE with no matching policy is a normal
--    success touching nothing, not a failure the client can detect. Fixed
--    here as a self-contained addition alongside the rest of this table's
--    RLS work, scoped to pending requests only (approved/rejected history
--    should never just disappear).

-- ── leave_requests: new types + Other's label ───────────────────────────────

alter table public.leave_requests drop constraint if exists leave_requests_type_check;
alter table public.leave_requests add constraint leave_requests_type_check
  check (type in ('Annual', 'Medical', 'Time-off', 'PH/Off-in-Lieu', 'Other'));

alter table public.leave_requests add column if not exists other_type_label text;

drop policy if exists "leaves_delete" on public.leave_requests;
create policy "leaves_delete" on public.leave_requests
  for delete using (
    status = 'pending'
    and (
      user_id = public.auth_user_app_id()
      or public.auth_user_role() = 'Super-Admin'
      or (public.auth_user_role() = 'Admin' and public.same_sub_account_as_caller(user_id::text))
      or (public.auth_user_role() = 'Manager' and public.is_in_caller_downline(user_id))
    )
  );

-- ── leave_adjustments: Admin-only credit/debit ledger ───────────────────────

create table public.leave_adjustments (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  type        text not null check (type in ('Annual', 'Medical', 'Time-off', 'PH/Off-in-Lieu', 'Other')),
  direction   text not null check (direction in ('credit', 'debit')),
  days        numeric not null check (days > 0),
  remarks     text not null,
  created_by  uuid references public.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index leave_adjustments_user_type_idx on public.leave_adjustments (user_id, type);

alter table public.leave_adjustments enable row level security;

-- Visible to the affected user (so they can see why their balance changed)
-- and Admin/Super-Admin. Deliberately no Manager bypass — this tool is
-- Admin-only, per explicit scope.
create policy "leave_adjustments_select" on public.leave_adjustments
  for select using (
    user_id = public.auth_user_app_id()
    or public.auth_user_role() = 'Super-Admin'
    or (public.auth_user_role() = 'Admin' and public.same_sub_account_as_caller(user_id::text))
  );

create policy "leave_adjustments_insert" on public.leave_adjustments
  for insert with check (
    created_by = public.auth_user_app_id()
    and (
      public.auth_user_role() = 'Super-Admin'
      or (
        public.auth_user_role() = 'Admin'
        and public.same_sub_account_as_caller(user_id::text)
        and public.target_user_is_active(user_id)
      )
    )
  );

create policy "leave_adjustments_update" on public.leave_adjustments
  for update using (
    public.auth_user_role() = 'Super-Admin'
    or (public.auth_user_role() = 'Admin' and public.same_sub_account_as_caller(user_id::text))
  )
  with check (
    public.auth_user_role() = 'Super-Admin'
    or (public.auth_user_role() = 'Admin' and public.same_sub_account_as_caller(user_id::text))
  );

create policy "leave_adjustments_delete" on public.leave_adjustments
  for delete using (
    public.auth_user_role() = 'Super-Admin'
    or (public.auth_user_role() = 'Admin' and public.same_sub_account_as_caller(user_id::text))
  );

notify pgrst, 'reload schema';
