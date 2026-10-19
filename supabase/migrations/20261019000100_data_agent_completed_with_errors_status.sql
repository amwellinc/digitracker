-- Migration 20261019000100: Data Agent — add 'completed_with_errors' to
-- data_agent_migrations.status.
--
-- The worker previously transitioned a migration to 'completed' whenever
-- nothing was left write_status: 'pending', with no regard for how many
-- rows ended up write_status: 'failed' — a run where every row failed to
-- write still reported 'completed', identical to a fully clean run (QA
-- sampling only covers 'created'/'replaced' rows, so it added no signal
-- either). This status lets a partial failure be distinguished from a
-- clean success without overloading 'failed', which already means "the
-- migration itself could not proceed at all" (e.g. no usable connection).
alter table public.data_agent_migrations drop constraint if exists data_agent_migrations_status_check;
alter table public.data_agent_migrations add constraint data_agent_migrations_status_check
  check (status in (
    'uploaded', 'mapping', 'awaiting_confirmation', 'migrating',
    'verifying', 'completed', 'completed_with_errors', 'failed', 'cancelled', 'undoing', 'undone'));
