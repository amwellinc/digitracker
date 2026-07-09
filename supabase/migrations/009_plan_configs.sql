-- Migration 009: Plan Configs table for editable pricing tiers

create table if not exists public.plan_configs (
  id             text primary key,  -- 'free' | 'basic' | 'business' | 'professional'
  name           text not null,
  price_monthly  numeric not null default 0,
  price_annual   numeric not null default 0,
  max_seats      int  not null default 3,
  features       text[] not null default '{}',
  is_active      boolean not null default true,
  sort_order     int  not null default 0,
  updated_at     timestamptz not null default now()
);

insert into public.plan_configs (id, name, price_monthly, price_annual, max_seats, features, sort_order)
values
  ('free',         'Free',         0,     0,      3,    ARRAY['Time tracking','Screenshots (7-day)','Basic reports'], 0),
  ('basic',        'Basic',        19.90, 199.00, 10,   ARRAY['Everything in Free','Calendar & Leave','Tasks & KPIs','30-day screenshots','Email support'], 1),
  ('business',     'Business',     39.90, 399.00, 100,  ARRAY['Everything in Basic','Documents module','Advanced reports','GHL integration','Priority support'], 2),
  ('professional', 'Professional', 99.90, 999.00, 1000, ARRAY['Everything in Business','Custom branding','API access','Dedicated support','SLA guarantee'], 3)
on conflict (id) do nothing;

alter table public.plan_configs enable row level security;

drop policy if exists "plan_configs_select_all"         on public.plan_configs;
drop policy if exists "plan_configs_write_super_admin"  on public.plan_configs;

create policy "plan_configs_select_all" on public.plan_configs
  for select using (true);

create policy "plan_configs_write_super_admin" on public.plan_configs
  for all using (public.auth_user_role() = 'Super-Admin')
  with check (public.auth_user_role() = 'Super-Admin');
