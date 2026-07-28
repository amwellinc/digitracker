-- Migration 038: Real inactivity detection for time tracking.
--
-- Reported: a user shows "Online" on the Admin dashboard while genuinely
-- inactive (AFK) for an hour. Root cause: the existing heartbeat
-- (last_seen_at, every 2 min) only proves the browser tab is alive — it is
-- not tied to any real mouse/keyboard activity, so it never goes stale while
-- a tab is simply left open. There was no signal anywhere for "the tab is
-- alive but the person isn't."
--
-- Fix: a second timestamp, last_activity_at, updated by the client only on
-- genuine input events (mousemove/keydown/scroll/click/touchstart), sent
-- piggybacked on the same heartbeat interval. The Admin dashboard computes
-- an "Idle" status (distinct from Online/On Lunch/Offline) when a session is
-- 'working' but last_activity_at is more than 20 minutes old — same
-- threshold as the existing abandoned-session detection (STALE_MS), per
-- product decision to keep one consistent idle definition. This does NOT
-- auto clock the user out — it's a visibility-only status.

alter table public.time_logs
  add column if not exists last_activity_at timestamptz;

-- Backfill so existing open sessions don't show as immediately idle before
-- their next heartbeat.
update public.time_logs
   set last_activity_at = coalesce(last_seen_at, clock_in)
 where status in ('working', 'lunch')
   and last_activity_at is null;

drop function if exists public.get_team_status(text, date);

create or replace function public.get_team_status(
  p_sub_account text,
  p_date        date
)
returns table (
  user_id         uuid,
  name            text,
  email           text,
  role            text,
  sub_account     text,
  profile_image   text,
  log_status      text,
  clock_in        timestamptz,
  last_seen_at    timestamptz,
  last_activity_at timestamptz,
  completed_mins  integer
)
security definer
set search_path = public
language plpgsql
as $$
declare
  v_caller_role        text;
  v_caller_sub_account text;
begin
  select u.role, u.sub_account
    into v_caller_role, v_caller_sub_account
    from public.users u
   where lower(u.email) = lower(auth.email())
   limit 1;

  if v_caller_role not in ('Admin', 'Manager', 'Super-Admin') then
    raise exception 'Access denied: insufficient role';
  end if;

  if v_caller_role != 'Super-Admin' and v_caller_sub_account != p_sub_account then
    raise exception 'Access denied: sub_account mismatch';
  end if;

  return query
  select
    u.id                                              as user_id,
    u.name,
    u.email,
    u.role,
    u.sub_account,
    u.profile_image,
    act.status                                        as log_status,
    act.clock_in,
    act.last_seen_at,
    act.last_activity_at,
    coalesce((
      select sum(done.total_minutes)::integer
        from public.time_logs done
       where done.user_id = u.id
         and done.date    = p_date
         and done.status  = 'clocked_out'
    ), 0)                                             as completed_mins
  from public.users u
  left join lateral (
    select tl.status, tl.clock_in, tl.last_seen_at, tl.last_activity_at
      from public.time_logs tl
     where tl.user_id = u.id
       and tl.date    = p_date
       and tl.status in ('working', 'lunch')
     limit 1
  ) act on true
  where u.sub_account = p_sub_account
  order by u.name;
end;
$$;

grant execute on function public.get_team_status(text, date) to authenticated;
