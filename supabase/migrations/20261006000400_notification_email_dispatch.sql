-- Migration 20261006000400: email project notifications (spec §3.2).
-- One-time manual setup (see Task 10): Vault secret "notification_email_secret"
-- must equal the edge function secret NOTIFICATION_EMAIL_SECRET.

create extension if not exists pg_net with schema extensions;

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
      url     := 'https://mllrjejqyddgaxxtjsqf.supabase.co/functions/v1/send-notification-email',
      body    := jsonb_build_object('notificationId', new.id),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-notification-secret', v_secret)
    );
  exception when others then
    raise warning 'notification email dispatch failed for %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists notifications_dispatch_email on public.notifications;
create trigger notifications_dispatch_email
  after insert on public.notifications
  for each row execute function public.dispatch_notification_email();
