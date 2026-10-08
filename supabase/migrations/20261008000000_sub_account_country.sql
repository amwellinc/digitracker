-- Migration 20261008000000: sub_accounts.country
--
-- A new sub-account (e.g. DERMITAGE, based in the Czech Republic) had no
-- way to record its own country, and its Admin/users had no way to select
-- it either -- COUNTRY_OPTIONS and TIMEZONE_OPTIONS (lib/constants.ts,
-- lib/timezone.ts) were both short hand-picked shortlists. Those are now
-- generated comprehensively (ISO 3166-1 regions, every IANA timezone), and
-- this adds the missing column so a sub-account's own country can be
-- stored and edited from Settings -> Account, alongside the existing
-- timezone column from migration 017.

alter table public.sub_accounts
  add column if not exists country text;

notify pgrst, 'reload schema';
