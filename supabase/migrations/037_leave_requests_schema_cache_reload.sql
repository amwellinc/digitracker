-- Migration 037: Fix "Could not find the 'remarks' column of 'leave_requests'
-- in the schema cache" on approve/reject.
--
-- migration 018 added leave_requests.remarks back on 2026-07-13, and every
-- migration since has applied cleanly through supabase db push — so the
-- column itself isn't in question. This error is PostgREST's own schema
-- cache being stale (it caches table/column metadata and only refreshes on
-- a DDL event or an explicit NOTIFY), not a missing column.
--
-- Fix: a defensive no-op ALTER (guarantees the column exists regardless of
-- any drift) followed by an explicit NOTIFY, which is the documented way to
-- force PostgREST to reload its schema cache without waiting for the next
-- unrelated migration to trigger it incidentally.

alter table public.leave_requests
  add column if not exists remarks text;

notify pgrst, 'reload schema';
