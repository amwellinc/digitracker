-- Migration 20261018000200: Data Agent — cron-polled worker invocation
-- (spec §7). One-time manual setup: a Vault secret named
-- "data_agent_worker_secret" must be created with the same value as the
-- data-agent-worker edge function's DATA_AGENT_WORKER_SECRET environment
-- secret (mirrors 20261006000400_notification_email_dispatch.sql's setup).

create or replace function public.trigger_data_agent_worker()
  returns void
  language plpgsql security definer
  set search_path = public
as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'data_agent_worker_secret';
  if v_secret is null then
    raise warning 'data_agent_worker_secret not set in Vault; Data Agent worker tick skipped';
    return;
  end if;

  perform net.http_post(
    url                  := 'https://mllrjejqyddgaxxtjsqf.supabase.co/functions/v1/data-agent-worker',
    body                 := '{}'::jsonb,
    headers              := jsonb_build_object('Content-Type', 'application/json', 'x-worker-secret', v_secret),
    timeout_milliseconds := 30000
  );
exception when others then
  raise warning 'Data Agent worker tick dispatch failed: %', sqlerrm;
end;
$$;
revoke execute on function public.trigger_data_agent_worker() from public, anon, authenticated;

select cron.unschedule('data-agent-worker-tick') from cron.job where jobname = 'data-agent-worker-tick';
select cron.schedule('data-agent-worker-tick', '* * * * *', $$ select public.trigger_data_agent_worker(); $$);
