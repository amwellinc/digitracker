create table public.time_log_correction_requests (
  id uuid primary key default gen_random_uuid(),
  time_log_id uuid not null references public.time_logs(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  requested_by uuid not null references public.users(id),
  original_total_minutes integer not null check (original_total_minutes >= 0),
  requested_total_minutes integer not null check (requested_total_minutes between 1 and 1440),
  reason text not null check (length(btrim(reason)) between 5 and 2000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references public.users(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now()
);

create index time_log_correction_requests_status_created_idx
  on public.time_log_correction_requests (status, created_at);

create unique index time_log_correction_requests_one_pending_per_log_idx
  on public.time_log_correction_requests (time_log_id)
  where status = 'pending';

alter table public.time_log_correction_requests enable row level security;

create policy time_log_correction_requests_deny_associates
  on public.time_log_correction_requests
  as restrictive for all to authenticated
  using (not (select public.is_associate()))
  with check (not (select public.is_associate()));

create policy "time_log_correction_requests_select"
  on public.time_log_correction_requests
  for select using (
    user_id = public.auth_user_app_id()
    or public.auth_user_role() = 'Super-Admin'
    or (public.auth_user_role() = 'Admin' and public.same_sub_account_as_caller(user_id::text))
    or (public.auth_user_role() = 'Manager' and public.is_in_caller_downline(user_id))
  );

create policy "time_log_correction_requests_insert_own"
  on public.time_log_correction_requests
  for insert with check (
    user_id = public.auth_user_app_id()
    and requested_by = public.auth_user_app_id()
    and status = 'pending'
  );

grant select, insert on public.time_log_correction_requests to authenticated;

create or replace function public.capture_time_log_correction_snapshot()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_total_minutes numeric;
  v_clock_out timestamptz;
  v_status text;
begin
  if new.user_id is distinct from public.auth_user_app_id()
     or new.requested_by is distinct from public.auth_user_app_id() then
    raise exception 'You can only request a correction for your own time log.';
  end if;

  select total_minutes, clock_out, status
    into v_total_minutes, v_clock_out, v_status
    from public.time_logs
   where id = new.time_log_id
     and user_id = new.user_id;

  if not found or v_clock_out is null or v_status <> 'clocked_out' then
    raise exception 'Corrections can only be requested for completed time logs.';
  end if;

  new.original_total_minutes := round(coalesce(v_total_minutes, 0))::integer;
  new.status := 'pending';
  new.reviewed_by := null;
  new.reviewed_at := null;
  new.review_note := null;
  return new;
end;
$$;

create trigger time_log_correction_snapshot_before_insert
  before insert on public.time_log_correction_requests
  for each row execute function public.capture_time_log_correction_snapshot();

create or replace function public.review_time_log_correction(
  p_request_id uuid,
  p_decision text,
  p_note text default null
)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_app_user_id uuid := public.auth_user_app_id();
  v_role text := public.auth_user_role();
  v_sub_account text;
  v_user_id uuid;
  v_time_log_id uuid;
  v_original_minutes integer;
  v_requested_minutes integer;
  v_status text;
begin
  if v_app_user_id is null or v_role is null or v_role not in ('Admin', 'Super-Admin') then
    raise exception 'Only an Admin can review time corrections.';
  end if;

  if p_decision is null or p_decision not in ('approved', 'rejected') then
    raise exception 'Decision must be approved or rejected.';
  end if;

  select r.user_id, r.time_log_id, r.original_total_minutes,
         r.requested_total_minutes, r.status, u.sub_account
    into v_user_id, v_time_log_id, v_original_minutes,
         v_requested_minutes, v_status, v_sub_account
    from public.time_log_correction_requests r
    join public.users u on u.id = r.user_id
   where r.id = p_request_id
   for update of r;

  if not found then
    raise exception 'Time correction request not found.';
  end if;

  if v_role = 'Admin' and v_sub_account is distinct from public.auth_user_sub_account() then
    raise exception 'You cannot review requests from another workspace.';
  end if;

  if v_status <> 'pending' then
    raise exception 'This time correction request has already been reviewed.';
  end if;

  if p_decision = 'approved' then
    update public.time_logs
       set total_minutes = v_requested_minutes
     where id = v_time_log_id
       and user_id = v_user_id
       and status = 'clocked_out'
       and round(total_minutes)::integer = v_original_minutes;

    if not found then
      raise exception 'The time log changed after this request was submitted. Refresh and review the latest record.';
    end if;
  end if;

  update public.time_log_correction_requests
     set status = p_decision,
         reviewed_by = v_app_user_id,
         reviewed_at = now(),
         review_note = nullif(left(btrim(coalesce(p_note, '')), 2000), '')
   where id = p_request_id;
end;
$$;

revoke all on function public.review_time_log_correction(uuid, text, text) from public;
grant execute on function public.review_time_log_correction(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
