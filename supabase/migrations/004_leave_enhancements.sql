-- Add hours column for time-off requests (1-4 hours per request)
alter table public.leave_requests
  add column if not exists hours numeric check (hours is null or (hours >= 1 and hours <= 4));

-- Tighten manager approval: manager can only approve direct reports' leaves
drop policy if exists "leave_update_manager" on public.leave_requests;
create policy "leave_update_manager" on public.leave_requests
  for update using (
    public.auth_user_role() = 'Super-admin'
    or (
      public.auth_user_role() = 'Manager'
      and exists (
        select 1 from public.users u
        where u.id = leave_requests.user_id
          and u.manager_id = auth.uid()
      )
    )
  );

-- Manager SELECT: see only own leaves + direct reports' leaves
drop policy if exists "leave_select" on public.leave_requests;
create policy "leave_select" on public.leave_requests
  for select using (
    user_id = auth.uid()
    or public.auth_user_role() = 'Super-admin'
    or (
      public.auth_user_role() = 'Manager'
      and exists (
        select 1 from public.users u
        where u.id = leave_requests.user_id
          and u.manager_id = auth.uid()
      )
    )
  );

-- Enable realtime for leave_requests
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.leave_requests;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
