alter table public.sub_accounts
  add column if not exists brand_color text not null default '#2563eb';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'sub_accounts_brand_color_check'
      and conrelid = 'public.sub_accounts'::regclass
  ) then
    alter table public.sub_accounts
      add constraint sub_accounts_brand_color_check
      check (brand_color ~ '^#[0-9A-Fa-f]{6}$');
  end if;
end
$$;
