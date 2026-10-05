-- Migration 20260927011921: placeholder for an out-of-band SQL editor change
--
-- On 2026-09-27 two storage policies were created directly in the Supabase
-- SQL editor (not via this repo), which recorded this version in the live
-- supabase_migrations.schema_migrations table. With no matching local file,
-- `supabase db push` in CI refused to run from 2026-09-29 onward.
--
-- The policies ("gdpr-temp-insert" / "gdpr-temp-select") let anonymous,
-- unauthenticated clients upload to and read from a "gdpr-temp" storage
-- bucket. Nothing in the app uses that bucket, and the access was not
-- wanted, so they are removed by 20261005000001_drop_gdpr_temp_anon_policies.sql.
--
-- This file intentionally runs nothing: it exists only so the CLI sees this
-- version as present locally. It is already marked applied on the live
-- database and will never execute there; on a fresh database it is a no-op,
-- which matches the intended end state.

select 1;
