-- Migration 053: track trial start date alongside the existing trial end
-- date, for a real free-trial signup (paid plan, trial_days > 0).
--
-- Companion to a provision-subscription rewrite: the previous version had
-- the customer set a password directly on the signup form and created the
-- Auth account immediately with email_confirm:true — no invite step at all,
-- and no on-screen or emailed confirmation of what was actually purchased.
-- A customer who signed up on the Free plan reported getting only a bare
-- "$0" impression with no account access and no invite. This migration adds
-- the one piece of state that was actually missing at the data layer:
-- trial_starts_at was never tracked, only trial_ends_at (039) — "mention
-- trial period start and end date" needs both ends of the range.

alter table public.sub_accounts add column if not exists trial_starts_at timestamptz;

notify pgrst, 'reload schema';
