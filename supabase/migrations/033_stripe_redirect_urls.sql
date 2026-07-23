-- Migration 033: Stripe Checkout redirect URLs
--
-- success_url / cancel_url are where Stripe Checkout sends the browser back
-- to after a subscription purchase completes or is abandoned. Defensive
-- ALTER TABLE ... ADD COLUMN IF NOT EXISTS keeps this safe to re-run.

alter table public.stripe_settings
  add column if not exists success_url text not null default '',
  add column if not exists cancel_url  text not null default '';
