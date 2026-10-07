-- Migration 20261007000000: Re-assert correct kpi_daily_logs INSERT/UPDATE RLS
--
-- Direct inspection of the live database (pg_policy) found kpi_daily_logs
-- still enforcing two policies that should have been superseded by
-- migration 014_fix_auth_user_linking.sql:
--
--   kpi_daily_logs_insert  WITH CHECK (user_id = auth.uid())
--   kpi_daily_logs_update  USING      (user_id = auth.uid())
--
-- Both compare against auth.uid() -- the raw Supabase Auth UUID -- instead
-- of auth_user_app_id() (the app's own public.users.id, matched by email).
-- These differ for any user created via the admin "Add User" flow, which
-- generates public.users.id client-side as crypto.randomUUID(), entirely
-- independent of whatever Supabase Auth id they're eventually assigned.
-- Confirmed for the specific reported case (cs1@amwelltechnologies.com):
-- public.users.id = 2076adf3-0201-4177-888b-0279dc6de57b, while
-- auth.users.id = 2138b11e-3ef6-4f5a-bb64-b6a82d4d00d4 -- the user_id =
-- auth.uid() check these policies perform can never pass for her, blocking
-- every EODR insert/update with no row-level-security error visible to a
-- Staff user beyond a generic save failure.
--
-- Migration 014's own file already defines the fix (auth_user_app_id()),
-- and schema_migrations records it as applied -- but the live policies
-- don't match that file's content, so whatever actually ran for that
-- version differed from what's in the repo today. This is the same drift
-- already found and reasserted twice before for time_logs
-- (059_time_logs_rls_reassert.sql) and payroll bank details
-- (048_payroll_bank_details_rls_reassert.sql). Rather than speculate on how
-- it drifted, this migration authoritatively reasserts the correct state
-- directly, the same remedy used both times before.

DROP POLICY IF EXISTS "kpi_daily_logs_insert" ON public.kpi_daily_logs;
DROP POLICY IF EXISTS "kpi_daily_logs_update" ON public.kpi_daily_logs;

CREATE POLICY "kpi_daily_logs_insert" ON public.kpi_daily_logs
  FOR INSERT WITH CHECK (user_id = public.auth_user_app_id());

CREATE POLICY "kpi_daily_logs_update" ON public.kpi_daily_logs
  FOR UPDATE USING (user_id = public.auth_user_app_id());

notify pgrst, 'reload schema';
