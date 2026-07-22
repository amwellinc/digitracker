-- Migration 022: Stripe gateway configuration (singleton table, Super-Admin only)
--
-- stripe_secret_key and stripe_webhook_secret are write-only from the client's
-- perspective: the app never selects them directly (see has_secret_key /
-- has_webhook_secret below, which let the UI show "a key is saved" without
-- ever reading the value back out). Actual use of the secret key happens only
-- in Supabase Edge Functions via the service-role key, which bypasses RLS.

create table if not exists public.stripe_settings (
  id                        uuid primary key default gen_random_uuid(),
  stripe_publishable_key    text not null default '',
  stripe_secret_key         text,
  stripe_webhook_secret     text,
  stripe_test_mode          boolean not null default true,
  trial_days                int not null default 14,
  grace_period_days         int not null default 3,
  max_failed_attempts       int not null default 3,
  auto_renewal              boolean not null default true,
  prorate_on_change         boolean not null default true,
  invoice_prefix            text not null default 'DT-',
  default_billing_cycle     text not null default 'monthly' check (default_billing_cycle in ('monthly', 'annual')),
  tax_rate                  numeric not null default 0,
  currency                  text not null default 'USD',
  cancel_at_period_end      boolean not null default true,
  tpl_new_subscription      jsonb not null default '{}'::jsonb,
  tpl_renewal_reminder      jsonb not null default '{}'::jsonb,
  tpl_payment_success       jsonb not null default '{}'::jsonb,
  tpl_subscription_changed  jsonb not null default '{}'::jsonb,
  has_secret_key            boolean generated always as (stripe_secret_key is not null and stripe_secret_key <> '') stored,
  has_webhook_secret        boolean generated always as (stripe_webhook_secret is not null and stripe_webhook_secret <> '') stored,
  updated_at                timestamptz not null default now()
);

alter table public.stripe_settings enable row level security;

create policy "super_admin_stripe_settings"
  on public.stripe_settings
  for all
  using  (public.auth_user_role() = 'Super-Admin')
  with check (public.auth_user_role() = 'Super-Admin');
