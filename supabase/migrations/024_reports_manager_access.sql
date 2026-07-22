-- Migration 024: opt-in flag letting an Admin grant Managers access to the
-- Reports section. Admins always have access regardless of this flag.

alter table public.sub_accounts
  add column if not exists managers_can_view_reports boolean not null default false;
