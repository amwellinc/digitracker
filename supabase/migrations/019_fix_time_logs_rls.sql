-- Migration 019: Re-apply correct time_logs and screenshots RLS
-- Ensures Admin / Manager / Super-Admin can read all time_logs in their workspace.
-- Uses auth_user_app_id() (email-based lookup) so users created via the admin UI
-- (whose users.id ≠ auth.uid()) can still access their own records.

-- ── Helper functions (idempotent re-create) ──────────────────────────────────

CREATE OR REPLACE FUNCTION public.auth_user_app_id()
  RETURNS uuid
  LANGUAGE sql SECURITY DEFINER STABLE
AS $$
  SELECT id FROM public.users WHERE LOWER(email) = LOWER(auth.email())
$$;

CREATE OR REPLACE FUNCTION public.auth_user_role()
  RETURNS text
  LANGUAGE sql SECURITY DEFINER STABLE
AS $$
  SELECT role FROM public.users WHERE LOWER(email) = LOWER(auth.email())
$$;

CREATE OR REPLACE FUNCTION public.auth_user_sub_account()
  RETURNS text
  LANGUAGE sql SECURITY DEFINER STABLE
AS $$
  SELECT sub_account FROM public.users WHERE LOWER(email) = LOWER(auth.email())
$$;

-- ── time_logs ─────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "time_logs_select"     ON public.time_logs;
DROP POLICY IF EXISTS "time_logs_insert_own" ON public.time_logs;
DROP POLICY IF EXISTS "time_logs_update"     ON public.time_logs;
DROP POLICY IF EXISTS "time_logs_update_own" ON public.time_logs;

CREATE POLICY "time_logs_select" ON public.time_logs
  FOR SELECT USING (
    user_id = public.auth_user_app_id()
    OR public.auth_user_role() IN ('Admin', 'Manager', 'Super-Admin')
  );

CREATE POLICY "time_logs_insert_own" ON public.time_logs
  FOR INSERT WITH CHECK (user_id = public.auth_user_app_id());

CREATE POLICY "time_logs_update" ON public.time_logs
  FOR UPDATE USING (
    user_id = public.auth_user_app_id()
    OR public.auth_user_role() IN ('Admin', 'Super-Admin')
  );

-- ── screenshots (DB table) ────────────────────────────────────────────────────

DROP POLICY IF EXISTS "screenshots_select"    ON public.screenshots;
DROP POLICY IF EXISTS "screenshots_insert_own" ON public.screenshots;
DROP POLICY IF EXISTS "screenshots_delete"    ON public.screenshots;

CREATE POLICY "screenshots_select" ON public.screenshots
  FOR SELECT USING (
    user_id = public.auth_user_app_id()
    OR public.auth_user_role() IN ('Admin', 'Manager', 'Super-Admin')
  );

CREATE POLICY "screenshots_insert_own" ON public.screenshots
  FOR INSERT WITH CHECK (user_id = public.auth_user_app_id());

CREATE POLICY "screenshots_delete" ON public.screenshots
  FOR DELETE USING (
    user_id = public.auth_user_app_id()
    OR public.auth_user_role() IN ('Admin', 'Super-Admin')
  );

-- ── storage.objects — screenshots ────────────────────────────────────────────

DROP POLICY IF EXISTS "screenshots_upload"     ON storage.objects;
DROP POLICY IF EXISTS "screenshots_read"       ON storage.objects;
DROP POLICY IF EXISTS "screenshots_delete_obj" ON storage.objects;

CREATE POLICY "screenshots_upload" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'screenshots'
    AND public.auth_user_app_id()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "screenshots_read" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'screenshots'
    AND (
      public.auth_user_app_id()::text = (storage.foldername(name))[1]
      OR public.auth_user_role() IN ('Admin', 'Manager', 'Super-Admin')
    )
  );

CREATE POLICY "screenshots_delete_obj" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'screenshots'
    AND (
      public.auth_user_app_id()::text = (storage.foldername(name))[1]
      OR public.auth_user_role() IN ('Admin', 'Super-Admin')
    )
  );
