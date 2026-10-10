-- Migration 20261010000000: drop the closed-list users_country_check
--
-- users_country_check (migration 010) hardcoded the 13-country list that
-- used to be the entire UserCountry type and COUNTRY_OPTIONS. Migration
-- 8bac0c8 ("let any sub-account and user pick any country and timezone")
-- widened UserCountry to a plain string and regenerated COUNTRY_OPTIONS
-- from every ISO 3166-1 region -- but never touched this DB-level
-- constraint, which still only allowed the original 13 codes. Any other
-- country (confirmed live: adding a user with any newly-available country)
-- failed with "new row for relation users violates check constraint
-- users_country_check", even though the app itself now offers that country
-- as a valid choice.
--
-- Replaced with a loose format check (two uppercase letters) instead of
-- another hardcoded enum -- COUNTRY_OPTIONS is generated at runtime from
-- Intl, not a fixed list this migration could mirror, so a format check is
-- the only DB-level validation that can stay correct as that list grows.
-- It still rejects obviously malformed values; it does not try to validate
-- against the real ISO-3166 set, which already happens at the application
-- boundary (COUNTRY_OPTIONS).

alter table public.users
  drop constraint if exists users_country_check;

alter table public.users
  add constraint users_country_check
    check (country ~ '^[A-Z]{2}$');
