-- Migration 010: Expand country check constraint to match COUNTRY_OPTIONS
-- Original constraint (003_add_user_country_phone.sql) only allowed SG/MY/PH
-- UserCountry type and COUNTRY_OPTIONS have 13 countries — align the DB constraint

alter table public.users
  drop constraint if exists users_country_check;

alter table public.users
  add constraint users_country_check
    check (country in ('SG', 'MY', 'PH', 'IN', 'AU', 'US', 'GB', 'ID', 'TH', 'VN', 'AE', 'CN', 'JP'));
