-- Add unique constraint: one KPI config per user
do $$ begin
  alter table public.kpis add constraint kpis_user_id_unique unique (user_id);
exception when others then null;
end $$;

-- Add structured kpi_items column (name, target, unit, period)
alter table public.kpis
  add column if not exists kpi_items jsonb not null default '[]';

-- Fix kpis RLS: allow admin/manager to create/update any user's KPI config
drop policy if exists "kpis_write_own" on public.kpis;

create policy "kpis_insert" on public.kpis
  for insert with check (
    user_id = auth.uid()
    or public.auth_user_role() in ('Super-admin', 'Manager')
  );
create policy "kpis_update" on public.kpis
  for update using (
    user_id = auth.uid()
    or public.auth_user_role() in ('Super-admin', 'Manager')
  );
create policy "kpis_delete" on public.kpis
  for delete using (
    user_id = auth.uid()
    or public.auth_user_role() = 'Super-admin'
  );

-- kpi_daily_logs: one submission per user per day (user fills daily actuals + checklist)
create table if not exists public.kpi_daily_logs (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.users(id) on delete cascade,
  date            date not null,
  metric_actuals  jsonb not null default '{}',
  checklist_done  jsonb not null default '[]',
  notes           text,
  submitted_at    timestamptz not null default now(),
  constraint kpi_daily_logs_user_date unique (user_id, date)
);

alter table public.kpi_daily_logs enable row level security;

create policy "kpi_daily_logs_select" on public.kpi_daily_logs
  for select using (
    user_id = auth.uid()
    or public.auth_user_role() in ('Super-admin', 'Manager')
  );

create policy "kpi_daily_logs_insert" on public.kpi_daily_logs
  for insert with check (user_id = auth.uid());

create policy "kpi_daily_logs_update" on public.kpi_daily_logs
  for update using (user_id = auth.uid());

-- Enable Realtime for daily logs
do $$ begin
  alter publication supabase_realtime add table public.kpi_daily_logs;
exception when others then null;
end $$;
