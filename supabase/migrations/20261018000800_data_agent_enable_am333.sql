-- Migration 20261018000800: Data Agent — enable the feature entitlement
-- for sub-account AM333 (requested directly, to unblock seeing the nav
-- item in the deployed app). Idempotent — safe to re-run.
insert into public.data_agent_entitlements (sub_account, enabled)
values ('AM333', true)
on conflict (sub_account) do update set enabled = true;
