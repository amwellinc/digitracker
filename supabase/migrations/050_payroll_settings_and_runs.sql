-- Migration 050: Payroll Settings (per-user template) and Generate Payroll
-- (free-form payroll runs + payslips), additive to the existing payroll_entries
-- ad-hoc payment ledger — that one is untouched and keeps working exactly as
-- it does today.
--
-- Same role model as payroll_entries throughout: Admin (own sub-account) and
-- Manager (own downline) can manage; the target user can always read their
-- own row; Super-Admin unrestricted. A payslip is not a separate entity —
-- it's just a formatted view of one payroll_runs row, rendered client-side.

-- ── payroll_settings: one row per user, the reusable template ──────────────

create table public.payroll_settings (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null unique references public.users(id) on delete cascade,
  currency                 text not null default 'SGD',

  gross_salary             numeric not null default 0,
  gross_salary_desc        text not null default '',

  overtime_enabled         boolean not null default false,
  overtime_amount          numeric not null default 0,
  overtime_desc            text not null default '',

  incentive_enabled        boolean not null default false,
  incentive_amount         numeric not null default 0,
  incentive_desc           text not null default '',

  commission_enabled       boolean not null default false,
  commission_amount        numeric not null default 0,
  commission_desc          text not null default '',

  cpf_enabled              boolean not null default false,
  cpf_amount               numeric not null default 0,
  cpf_desc                 text not null default '',

  insurance_enabled        boolean not null default false,
  insurance_amount         numeric not null default 0,
  insurance_desc           text not null default '',

  other_deduction_enabled  boolean not null default false,
  other_deduction_amount   numeric not null default 0,
  other_deduction_desc     text not null default '',

  updated_by               uuid references public.users(id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

alter table public.payroll_settings enable row level security;

create policy "payroll_settings_select" on public.payroll_settings
  for select using (
    user_id = public.auth_user_app_id()
    or public.auth_user_role() = 'Super-Admin'
    or (public.auth_user_role() = 'Admin' and public.same_sub_account_as_caller(user_id::text))
    or (public.auth_user_role() = 'Manager' and public.is_in_caller_downline(user_id))
  );

create policy "payroll_settings_insert" on public.payroll_settings
  for insert with check (
    public.auth_user_role() = 'Super-Admin'
    or (
      public.auth_user_role() = 'Admin'
      and public.same_sub_account_as_caller(user_id::text)
      and public.target_user_is_active(user_id)
    )
    or (
      public.auth_user_role() = 'Manager'
      and public.is_in_caller_downline(user_id)
      and public.target_user_is_active(user_id)
    )
  );

create policy "payroll_settings_update" on public.payroll_settings
  for update using (
    public.auth_user_role() = 'Super-Admin'
    or (public.auth_user_role() = 'Admin' and public.same_sub_account_as_caller(user_id::text))
    or (public.auth_user_role() = 'Manager' and public.is_in_caller_downline(user_id))
  )
  with check (
    public.auth_user_role() = 'Super-Admin'
    or (public.auth_user_role() = 'Admin' and public.same_sub_account_as_caller(user_id::text))
    or (public.auth_user_role() = 'Manager' and public.is_in_caller_downline(user_id))
  );

create policy "payroll_settings_delete" on public.payroll_settings
  for delete using (
    public.auth_user_role() = 'Super-Admin'
    or (public.auth_user_role() = 'Admin' and public.same_sub_account_as_caller(user_id::text))
    or (public.auth_user_role() = 'Manager' and public.is_in_caller_downline(user_id))
  );

-- ── payroll_runs: free-form generated payroll (no period concept) ──────────

create table public.payroll_runs (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references public.users(id) on delete cascade,
  payment_date             date not null,
  currency                 text not null default 'SGD',

  gross_salary             numeric not null default 0,
  gross_salary_desc        text not null default '',

  overtime_amount          numeric not null default 0,
  overtime_desc            text not null default '',

  incentive_amount         numeric not null default 0,
  incentive_desc           text not null default '',

  commission_amount        numeric not null default 0,
  commission_desc          text not null default '',

  cpf_amount               numeric not null default 0,
  cpf_desc                 text not null default '',

  insurance_amount         numeric not null default 0,
  insurance_desc           text not null default '',

  other_deduction_amount   numeric not null default 0,
  other_deduction_desc     text not null default '',

  net_pay                  numeric not null default 0,

  created_by               uuid references public.users(id) on delete set null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create index payroll_runs_user_date_idx on public.payroll_runs (user_id, payment_date desc);

alter table public.payroll_runs enable row level security;

create policy "payroll_runs_select" on public.payroll_runs
  for select using (
    user_id = public.auth_user_app_id()
    or public.auth_user_role() = 'Super-Admin'
    or (public.auth_user_role() = 'Admin' and public.same_sub_account_as_caller(user_id::text))
    or (public.auth_user_role() = 'Manager' and public.is_in_caller_downline(user_id))
  );

create policy "payroll_runs_insert" on public.payroll_runs
  for insert with check (
    created_by = public.auth_user_app_id()
    and (
      public.auth_user_role() = 'Super-Admin'
      or (
        public.auth_user_role() = 'Admin'
        and public.same_sub_account_as_caller(user_id::text)
        and public.target_user_is_active(user_id)
      )
      or (
        public.auth_user_role() = 'Manager'
        and public.is_in_caller_downline(user_id)
        and public.target_user_is_active(user_id)
      )
    )
  );

create policy "payroll_runs_update" on public.payroll_runs
  for update using (
    public.auth_user_role() = 'Super-Admin'
    or (public.auth_user_role() = 'Admin' and public.same_sub_account_as_caller(user_id::text))
    or (public.auth_user_role() = 'Manager' and public.is_in_caller_downline(user_id))
  )
  with check (
    public.auth_user_role() = 'Super-Admin'
    or (public.auth_user_role() = 'Admin' and public.same_sub_account_as_caller(user_id::text))
    or (public.auth_user_role() = 'Manager' and public.is_in_caller_downline(user_id))
  );

create policy "payroll_runs_delete" on public.payroll_runs
  for delete using (
    public.auth_user_role() = 'Super-Admin'
    or (public.auth_user_role() = 'Admin' and public.same_sub_account_as_caller(user_id::text))
    or (public.auth_user_role() = 'Manager' and public.is_in_caller_downline(user_id))
  );

notify pgrst, 'reload schema';
