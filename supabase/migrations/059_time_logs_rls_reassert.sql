-- Migration 059: Re-assert correct time_logs INSERT/UPDATE RLS
--
-- Direct inspection of the live database (pg_policy) found time_logs still
-- enforcing two policies that should have been superseded by migration 019:
--
--   time_logs_insert_own  WITH CHECK (user_id = auth.uid())
--   time_logs_update_own  USING      (user_id = auth.uid())
--
-- Both compare against auth.uid() -- the raw Supabase Auth UUID -- instead
-- of auth_user_app_id() (the app's own public.users.id, matched by email).
-- These differ for any user created via the admin "Add User" flow, which
-- generates public.users.id client-side as crypto.randomUUID(), entirely
-- independent of whatever Supabase Auth id they're eventually assigned.
-- For any such user (the normal onboarding path in this app), the INSERT
-- these two policies gate can never satisfy user_id = auth.uid() -- it's a
-- guaranteed clock-in failure, not a session/token issue.
--
-- Migration 019's own file already defines the fix (DROP + CREATE with
-- auth_user_app_id()), and schema_migrations records it as applied -- but
-- the live policies don't match that file's content, so whatever actually
-- ran for that version differed from what's in the repo today. Rather than
-- speculate on how that drifted, this migration authoritatively reasserts
-- the correct state directly, the same remedy already used once before in
-- this project's history (048_payroll_bank_details_rls_reassert.sql).

DROP POLICY IF EXISTS "time_logs_insert_own" ON public.time_logs;
DROP POLICY IF EXISTS "time_logs_update_own" ON public.time_logs;

CREATE POLICY "time_logs_insert_own" ON public.time_logs
  FOR INSERT WITH CHECK (user_id = public.auth_user_app_id());

-- time_logs_update (auth_user_app_id() + Admin/Super-Admin) already exists
-- and is correct -- time_logs_update_own was a redundant, stale duplicate
-- covering the same UPDATE command with the wrong check, not a distinct
-- capability, so it's dropped above with no replacement needed.

notify pgrst, 'reload schema';
