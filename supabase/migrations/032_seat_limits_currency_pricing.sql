-- Migration 032: Seat-limit enforcement, Free-plan screenshot/document caps,
-- and database-backed multi-currency pricing.
--
-- Deliberately does NOT touch plan_configs.price_monthly / price_annual /
-- max_seats — those are live Super-Admin-configured values (edited directly
-- through Platform Admin -> Plans & Pricing) and must not be overwritten by
-- a migration. Enforcement below always reads them live, so it automatically
-- tracks whatever Super-Admin has configured, including future edits.

-- ── "Open up all features" — every plan gets the same full feature list.
--    The only plan-specific differentiator becomes Free's own limitations
--    (seats stays whatever max_seats is already configured; screenshot
--    retention and document storage are enforced in code below).
update public.plan_configs set features = array[
  'Live time tracking with clock in/out',
  'Screen capture proof-of-work',
  'Live team dashboard & real-time status',
  'Calendar, holidays & leave management',
  'Tasks, KPIs & daily EOD reports',
  'HR documents & bank details vault',
  'Payroll history & reports',
  'Manager & role-based access control',
  'GHL-CRM integration',
  'Custom logo & company branding'
] || case when id = 'free' then array[
  '-Screenshots kept for 7 days',
  '-HR documents capped at 50MB per user'
] else array[]::text[] end;

-- ── Seat-limit enforcement ─────────────────────────────────────────────────

create or replace function public.sub_account_seat_count(p_sub_account text)
  returns int
  language sql security definer stable
as $$
  select count(*)::int from public.users where sub_account = p_sub_account
$$;

create or replace function public.sub_account_max_seats(p_sub_account text)
  returns int
  language sql security definer stable
as $$
  select coalesce(
    (select pc.max_seats
       from public.sub_accounts sa
       join public.plan_configs pc on pc.id = sa.plan
      where sa.code = p_sub_account),
    3
  )
$$;

create or replace function public.sub_account_has_seat_capacity(p_sub_account text)
  returns boolean
  language sql security definer stable
as $$
  select public.sub_account_seat_count(p_sub_account) < public.sub_account_max_seats(p_sub_account)
$$;

grant execute on function public.sub_account_seat_count(text) to authenticated;
grant execute on function public.sub_account_max_seats(text) to authenticated;
grant execute on function public.sub_account_has_seat_capacity(text) to authenticated;

drop policy if exists "users_insert_admin" on public.users;

create policy "users_insert_admin" on public.users
  for insert with check (
    public.auth_user_role() = 'Super-Admin'
    or (
      public.auth_user_role() = 'Admin'
      and sub_account = public.auth_user_sub_account()
      and public.sub_account_has_seat_capacity(sub_account)
    )
  );

-- ── Free-plan HR document storage cap (50MB per user, cumulative) ────────────

create or replace function public.user_document_storage_ok(p_user_id uuid, p_new_size numeric)
  returns boolean
  language plpgsql security definer stable
as $$
declare
  v_plan text;
  v_existing numeric;
begin
  select sa.plan into v_plan
    from public.users u
    join public.sub_accounts sa on sa.code = u.sub_account
   where u.id = p_user_id;

  if v_plan is distinct from 'free' then
    return true;
  end if;

  select coalesce(sum(size), 0) into v_existing from public.documents where user_id = p_user_id;

  return (v_existing + coalesce(p_new_size, 0)) <= 52428800; -- 50 MB
end;
$$;

grant execute on function public.user_document_storage_ok(uuid, numeric) to authenticated;

drop policy if exists "documents_insert" on public.documents;

create policy "documents_insert" on public.documents
  for insert with check (
    (
      user_id = public.auth_user_app_id()
      or public.auth_user_role() = 'Super-Admin'
      or (public.auth_user_role() = 'Admin' and public.same_sub_account_as_caller(user_id::text))
    )
    and public.user_document_storage_ok(user_id, size)
  );

-- ── Free-plan screenshot retention: 7 days (others keep the existing 30) ────

select cron.unschedule('purge-old-screenshots') from cron.job where jobname = 'purge-old-screenshots';
select cron.schedule(
  'purge-old-screenshots',
  '0 0 * * 0',
  $$
    delete from storage.objects so
    using public.users u, public.sub_accounts sa
    where so.bucket_id = 'screenshots'
      and (storage.foldername(so.name))[1] = u.id::text
      and u.sub_account = sa.code
      and so.created_at < now() - (case when sa.plan = 'free' then interval '7 days' else interval '30 days' end);

    delete from storage.objects
    where bucket_id = 'screenshots'
      and created_at < now() - interval '30 days'
      and not exists (
        select 1 from public.users u2 where u2.id::text = (storage.foldername(name))[1]
      );

    delete from public.screenshots ps
    using public.users u, public.sub_accounts sa
    where ps.user_id = u.id
      and u.sub_account = sa.code
      and ps.timestamp < now() - (case when sa.plan = 'free' then interval '7 days' else interval '30 days' end);

    delete from public.screenshots
    where timestamp < now() - interval '30 days'
      and user_id not in (select id from public.users);
  $$
);

-- ── Multi-currency pricing ────────────────────────────────────────────────
-- Super-Admin-manageable currencies + per-plan pricing. Migrates the
-- previously hardcoded PLAN_CURRENCIES constant into real, editable rows.
-- Free is intentionally excluded — always $0 in every currency, handled in
-- the UI rather than stored.

create table if not exists public.currencies (
  code        text primary key,
  symbol      text not null,
  country     text not null,
  flag        text not null default '',
  is_active   boolean not null default true,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

create table if not exists public.plan_currency_pricing (
  id             uuid primary key default gen_random_uuid(),
  plan_id        text not null references public.plan_configs(id) on delete cascade,
  currency_code  text not null references public.currencies(code) on delete cascade,
  price_monthly  numeric not null default 0,
  price_annual   numeric not null default 0,
  updated_at     timestamptz not null default now(),
  unique (plan_id, currency_code)
);

alter table public.currencies enable row level security;
alter table public.plan_currency_pricing enable row level security;

drop policy if exists "currencies_select_all"        on public.currencies;
drop policy if exists "currencies_write_super_admin"  on public.currencies;

create policy "currencies_select_all" on public.currencies
  for select using (true);

create policy "currencies_write_super_admin" on public.currencies
  for all using (public.auth_user_role() = 'Super-Admin')
  with check (public.auth_user_role() = 'Super-Admin');

drop policy if exists "plan_currency_pricing_select_all"       on public.plan_currency_pricing;
drop policy if exists "plan_currency_pricing_write_super_admin" on public.plan_currency_pricing;

create policy "plan_currency_pricing_select_all" on public.plan_currency_pricing
  for select using (true);

create policy "plan_currency_pricing_write_super_admin" on public.plan_currency_pricing
  for all using (public.auth_user_role() = 'Super-Admin')
  with check (public.auth_user_role() = 'Super-Admin');

insert into public.currencies (code, symbol, country, flag, sort_order) values
  ('USD','$','United States','🇺🇸',0),
  ('SGD','S$','Singapore','🇸🇬',1),
  ('INR','₹','India','🇮🇳',2),
  ('MYR','RM','Malaysia','🇲🇾',3),
  ('PHP','₱','Philippines','🇵🇭',4),
  ('AUD','A$','Australia','🇦🇺',5),
  ('GBP','£','United Kingdom','🇬🇧',6),
  ('AED','AED','UAE','🇦🇪',7),
  ('IDR','Rp','Indonesia','🇮🇩',8),
  ('THB','฿','Thailand','🇹🇭',9),
  ('JPY','¥','Japan','🇯🇵',10)
on conflict (code) do nothing;

-- Annual prices computed at the same 20% discount already used for USD on
-- the marketing site (digitracker-landing.html) — verify/adjust in the new
-- Currency Pricing panel if actual local rates differ.
insert into public.plan_currency_pricing (plan_id, currency_code, price_monthly, price_annual)
values
  ('basic','USD',19.90,15.90),        ('business','USD',39.90,31.90),        ('professional','USD',99.90,79.90),
  ('basic','SGD',26.90,21.90),        ('business','SGD',53.90,42.90),        ('professional','SGD',134.90,107.90),
  ('basic','INR',1650,1320),          ('business','INR',3310,2650),          ('professional','INR',8290,6630),
  ('basic','MYR',93.90,74.90),        ('business','MYR',187.90,150.90),      ('professional','MYR',469.90,375.90),
  ('basic','PHP',1115,890),           ('business','PHP',2235,1790),          ('professional','PHP',5595,4475),
  ('basic','AUD',30.90,24.90),        ('business','AUD',61.90,49.90),        ('professional','AUD',154.90,123.90),
  ('basic','GBP',15.90,12.90),        ('business','GBP',31.90,25.90),        ('professional','GBP',79.90,63.90),
  ('basic','AED',73.90,59.90),        ('business','AED',147.90,118.90),      ('professional','AED',369.90,295.90),
  ('basic','IDR',315000,252000),      ('business','IDR',630000,504000),      ('professional','IDR',1575000,1260000),
  ('basic','THB',720,576),            ('business','THB',1440,1150),          ('professional','THB',3600,2880),
  ('basic','JPY',2990,2390),          ('business','JPY',5990,4790),          ('professional','JPY',14990,11990)
on conflict (plan_id, currency_code) do nothing;
