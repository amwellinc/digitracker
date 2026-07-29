-- Migration 039: Self-service subscription signup support.
--
-- The provision-subscription Edge Function creates a sub_accounts row up
-- front (status 'trialing' or 'active') before sending the customer to
-- Stripe Checkout, matching the client_reference_id pattern the existing
-- stripe-webhook already assumes (it UPDATEs sub_accounts, never INSERTs).
-- trial_ends_at is purely informational — Stripe is the source of truth for
-- the actual subscription/trial state — but it lets the Admin dashboard and
-- Thank You page show a real date without a Stripe API round-trip.

alter table public.sub_accounts
  add column if not exists trial_ends_at timestamptz;

-- stripe_settings is Super-Admin-only (it holds secret keys), but the public
-- /subscribe page needs to display the trial length. A narrow SECURITY
-- DEFINER function exposes just that one integer, nothing else in the table.
create or replace function public.get_trial_days()
  returns integer
  language sql security definer stable
as $$
  select trial_days from public.stripe_settings limit 1
$$;

grant execute on function public.get_trial_days() to anon, authenticated;
