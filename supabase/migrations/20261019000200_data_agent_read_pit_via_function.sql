-- Migration 20261019000200: Data Agent — read the GHL PIT via a
-- SECURITY DEFINER function instead of PostgREST's vault schema route.
--
-- Every edge function that needs the decrypted PIT (test-connection,
-- upload's schema refresh, and the worker's actual GHL writes) was
-- reading it via `serviceClient.schema('vault').from('decrypted_secrets')`
-- — i.e. through PostgREST's HTTP API. That path only works if 'vault' is
-- explicitly added to the project's exposed API schemas (Project Settings
-- > API > Exposed schemas), which is NOT the default and was never set
-- here — Supabase's own docs recommend against it for exactly this
-- reason, since it puts the whole vault schema on the API surface.
-- Every one of those calls was silently returning no row (the resulting
-- PostgREST error was discarded in two of the three call sites), which
-- surfaced to the user as "Saved token could not be read from Vault" —
-- and, far more importantly, meant the worker could never actually load
-- a usable GHL connection either, so no migration could ever write a
-- single row.
--
-- save_data_agent_connection already works around this for WRITES by
-- reading/writing vault.secrets directly in plain SQL inside a plpgsql
-- function — PostgREST's schema-exposure restriction only applies to its
-- own HTTP routes, never to SQL executed server-side. This function does
-- the equivalent for reads: it is called via RPC (always reachable,
-- regardless of exposed schemas, since the function itself lives in
-- `public`), and only the service role may ever call it.
create or replace function public.get_data_agent_pit(p_sub_account text)
  returns text
  language plpgsql security definer
  set search_path = public
as $$
declare
  v_secret_name text;
  v_pit text;
begin
  select secret_name into v_secret_name from public.data_agent_connections where sub_account = p_sub_account;
  if v_secret_name is null then return null; end if;
  select decrypted_secret into v_pit from vault.decrypted_secrets where name = v_secret_name;
  return v_pit;
end;
$$;
-- Never granted to anon/authenticated — it returns the raw PIT in
-- plaintext, so only server-side edge-function code (via the service
-- role) may ever call it.
revoke execute on function public.get_data_agent_pit(text) from public, anon, authenticated;
grant execute on function public.get_data_agent_pit(text) to service_role;
