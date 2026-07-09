-- Migration 012: Platform-level settings (SMTP, branding)
-- Singleton table: always upsert into id = fixed UUID

create table if not exists public.platform_settings (
  id          uuid primary key default gen_random_uuid(),
  smtp_host   text,
  smtp_port   int  not null default 587,
  smtp_secure boolean not null default false,
  smtp_user   text,
  smtp_pass   text,
  from_email  text,
  from_name   text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.users(id) on delete set null
);

alter table public.platform_settings enable row level security;

-- Only Super-Admin can read or write platform settings
create policy "super_admin_platform_settings"
  on public.platform_settings
  for all
  using  (public.auth_user_role() = 'Super-Admin')
  with check (public.auth_user_role() = 'Super-Admin');
