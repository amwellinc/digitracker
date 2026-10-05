-- Migration 20261005000001: remove anonymous access to the gdpr-temp bucket
--
-- Undoes the two policies created out-of-band on 2026-09-27 (see
-- 20260927011921_gdpr_temp_bucket_policies.sql). They let unauthenticated
-- clients upload any file to, and read every file from, the "gdpr-temp"
-- storage bucket. Nothing in the app uses that bucket.

drop policy if exists "gdpr-temp-insert" on storage.objects;
drop policy if exists "gdpr-temp-select" on storage.objects;
