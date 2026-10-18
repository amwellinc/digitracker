-- Migration 20261018000300: Data Agent — claim pending migration_records
-- before writing them to GHL, so two overlapping worker ticks can't both
-- pick up and process the same batch (see Task 15's review for why this
-- is a real, non-contrived risk, not just a theoretical one).
alter table public.data_agent_migration_records add column claimed_at timestamptz;
create index data_agent_migration_records_claim_idx on public.data_agent_migration_records (migration_id, write_status, claimed_at);
