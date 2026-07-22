-- Migration 023: Payment transaction history, populated by the stripe-webhook
-- Edge Function (service-role only — no client ever writes to this table).

-- checkout.session.completed carries client_reference_id (the sub_account code)
-- directly, but later events for the same customer (invoice.*, customer.subscription.*)
-- only carry a Stripe customer ID. Storing it once on first checkout lets the
-- webhook resolve sub_account for every subsequent event on that customer.
alter table public.sub_accounts add column if not exists stripe_customer_id text;
create index if not exists sub_accounts_stripe_customer_id_idx on public.sub_accounts(stripe_customer_id);

create table if not exists public.payment_transactions (
  id                uuid primary key default gen_random_uuid(),
  sub_account       text references public.sub_accounts(code) on delete set null,
  stripe_event_id   text unique not null, -- idempotency: Stripe may redeliver the same event
  stripe_customer_id text,
  stripe_invoice_id text,
  event_type        text not null,   -- e.g. checkout.session.completed, invoice.payment_failed
  status            text not null check (status in ('succeeded', 'failed', 'pending', 'refunded')),
  amount            numeric,          -- major currency unit (e.g. dollars, not cents)
  currency          text,
  plan              text,
  billing_cycle     text,
  failure_reason    text,
  raw_event         jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now()
);

create index if not exists payment_transactions_sub_account_idx on public.payment_transactions(sub_account, created_at desc);
create index if not exists payment_transactions_status_idx on public.payment_transactions(status);

alter table public.payment_transactions enable row level security;

-- Super-Admin sees everything; a sub-account's own Admin can see their own
-- transactions (read-only — writes only ever happen via the service-role
-- client inside the webhook, which bypasses RLS entirely).
create policy "payment_transactions_select"
  on public.payment_transactions
  for select
  using (
    public.auth_user_role() = 'Super-Admin'
    or (
      public.auth_user_role() = 'Admin'
      and sub_account = (select u.sub_account from public.users u where u.id = auth.uid())
    )
  );
