-- Migration 043: Ground-truth check of what's ACTUALLY deployed on tasks.
--
-- debug_task_insert_values (042) mirrors what migration 036 SHOULD have
-- deployed as tasks_insert's WITH CHECK, and against the real submitted
-- values (both ids = a3e65b47-..., both in sub_account AM333) it reports
-- both clauses passing — yet the real INSERT still gets rejected by RLS.
-- If a faithful reproduction of the policy expression passes while the
-- actual policy enforcement rejects the same values, the only remaining
-- explanation is that the LIVE policy on the table isn't what the migration
-- files say it should be — e.g. a migration-history mismatch where
-- `supabase db push` believed 036 was already applied and skipped it, or
-- applied something else. Rather than infer that from more mirrored logic
-- (which assumes the same possibly-wrong mental model), this reads
-- Postgres's own catalog for the literal, currently-active policy
-- definitions on public.tasks — the one source that can't be stale.

create or replace function public.debug_tasks_policies()
  returns jsonb
  language sql security definer stable
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'policyname', policyname,
    'cmd',        cmd,
    'permissive', permissive,
    'roles',      roles,
    'qual',       qual,
    'with_check', with_check
  ) order by policyname), '[]'::jsonb)
  from pg_policies
  where schemaname = 'public' and tablename = 'tasks'
$$;

grant execute on function public.debug_tasks_policies() to authenticated;
