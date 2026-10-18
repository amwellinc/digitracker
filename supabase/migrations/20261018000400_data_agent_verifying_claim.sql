-- Migration 20261018000400: Data Agent — claim data_agent_migrations before
-- the verifying phase processes one, so overlapping worker ticks can't
-- both pick up and process the same migration (same idiom as Task 15's
-- claimed_at on data_agent_migration_records, applied here at the
-- migration level since the verifying phase has no per-record table to
-- claim against instead).
alter table public.data_agent_migrations add column claimed_at timestamptz;
