-- Migration 20261006000500: give notification emails time to send.
--
-- 20261006000400 called net.http_post with pg_net's default 5 s timeout.
-- The first live dispatch (2026-10-05) timed out at 5 s: send-notification-email
-- needs ~1.5-2 s to start and read the notification, plus the SMTP connect and
-- send. pg_net runs after commit in a background worker, so a longer timeout
-- never delays the user's write — it only stops the request being abandoned
-- mid-send. Function body otherwise unchanged from 20261006000400.

create or replace function public.dispatch_notification_email()
  returns trigger
  language plpgsql security definer
  set search_path = public
as $$
declare
  v_secret text;
begin
  if new.type not like 'project\_%' or new.project_id is null then
    return new;
  end if;
  if new.type <> 'project_added'
     and not exists (select 1 from public.users where id = new.user_id and role = 'Associate') then
    return new;
  end if;

  begin
    select decrypted_secret into v_secret
      from vault.decrypted_secrets where name = 'notification_email_secret';
    if v_secret is null then
      raise warning 'notification_email_secret not set in Vault; email for notification % skipped', new.id;
      return new;
    end if;

    perform net.http_post(
      url                  := 'https://mllrjejqyddgaxxtjsqf.supabase.co/functions/v1/send-notification-email',
      body                 := jsonb_build_object('notificationId', new.id),
      headers              := jsonb_build_object('Content-Type', 'application/json', 'x-notification-secret', v_secret),
      timeout_milliseconds := 30000
    );
  exception when others then
    raise warning 'notification email dispatch failed for %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;
