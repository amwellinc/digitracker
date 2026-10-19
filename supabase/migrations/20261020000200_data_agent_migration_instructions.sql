-- Migration 20261020000200: Data Agent — capture free-text instructions
-- for the AI mapping agent on New Migration.
--
-- There was no way to tell the agent anything beyond target object +
-- source system before — a user wanting to say "treat this column as
-- tags" or flag something about the file had no channel to do so. This
-- column stores what was typed so it's visible on the migration later,
-- not just consumed once by the Claude prompt and discarded.
alter table public.data_agent_migrations add column instructions text;
