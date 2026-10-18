-- Migration 20261018000700: Data Agent — service-provider (agency) grants
-- (spec §2.1). Redefines is_data_agent_member() from migration
-- 20261018000000, the same way migration 027 redefined auth_user_app_id()
-- from migration 025 — this codebase's established pattern for extending
-- an already-shipped SECURITY DEFINER helper rather than editing the
-- migration that first defined it.

create table public.data_agent_provider_clients (
  provider_sub_account text not null references public.sub_accounts(code) on delete cascade,
  client_sub_account   text not null references public.sub_accounts(code) on delete cascade,
  added_by             uuid references public.users(id) on delete set null,
  added_at             timestamptz not null default now(),
  primary key (provider_sub_account, client_sub_account),
  check (provider_sub_account <> client_sub_account)
);

alter table public.data_agent_provider_clients enable row level security;

create policy data_agent_provider_clients_select on public.data_agent_provider_clients
  for select using (
    public.auth_user_role() = 'Super-Admin'
    or public.auth_user_sub_account() in (provider_sub_account, client_sub_account)
  );
create policy data_agent_provider_clients_write on public.data_agent_provider_clients
  for all using (public.auth_user_role() = 'Super-Admin')
  with check (public.auth_user_role() = 'Super-Admin');

create policy data_agent_provider_clients_deny_associates on public.data_agent_provider_clients
  as restrictive for all to authenticated
  using (not (select public.is_associate())) with check (not (select public.is_associate()));

-- ── Extend the access gate ───────────────────────────────────────────────────
-- coalesce(..., false) at the top level, same as Task 1's original
-- definition this replaces — this redefinition must independently
-- preserve the "always true or false, never null" contract (see Task 1's
-- comment on this function for why); a redefinition that dropped it would
-- silently reopen the exact fail-open hole Task 7's review found.
create or replace function public.is_data_agent_member(p_sub_account text)
  returns boolean
  language sql security definer stable
  set search_path = public
as $$
  select coalesce(
    exists (select 1 from public.data_agent_entitlements e where e.sub_account = p_sub_account and e.enabled)
    and (
      public.auth_user_role() = 'Super-Admin'
      or (
        public.auth_user_sub_account() = p_sub_account
        and (
          public.auth_user_role() = 'Admin'
          or exists (select 1 from public.data_agent_members m where m.sub_account = p_sub_account and m.user_id = public.auth_user_app_id())
        )
      )
      -- A member/Admin of a sub-account Super-Admin has authorized to act
      -- as a provider for p_sub_account (spec §2.1). The client sub-account
      -- must still be entitled (the first exists() above) — this clause
      -- only extends *who* qualifies once it is. The provider's OWN
      -- entitlement is checked too, independently of the client's — without
      -- this, revoking a provider's data_agent_entitlements row (e.g. its
      -- subscription lapsed, or Super-Admin is locking it out during an
      -- incident) would do nothing to a provider grant it already holds:
      -- the client's entitlement alone would keep letting it through. The
      -- two pre-existing OR-branches above never hit this gap because for
      -- both of them the caller's own sub_account IS p_sub_account, so
      -- "the target is entitled" and "the caller's sub_account is entitled"
      -- were always the same fact — this is the one branch where they can
      -- genuinely diverge, since the caller (provider) and the target
      -- (client) are different sub-accounts.
      or exists (
        select 1 from public.data_agent_provider_clients pc
        where pc.client_sub_account = p_sub_account
          and pc.provider_sub_account = public.auth_user_sub_account()
          and exists (select 1 from public.data_agent_entitlements pe where pe.sub_account = pc.provider_sub_account and pe.enabled)
          and (
            public.auth_user_role() = 'Admin'
            or exists (select 1 from public.data_agent_members m2 where m2.sub_account = pc.provider_sub_account and m2.user_id = public.auth_user_app_id())
          )
      )
    ),
    false
  )
$$;
revoke execute on function public.is_data_agent_member(text) from public, anon;
grant execute on function public.is_data_agent_member(text) to authenticated;
