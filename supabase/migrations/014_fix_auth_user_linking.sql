-- Migration 014: Fix auth-to-app-users linking
--
-- Root cause: Users created via the admin UI get users.id = gen_random_uuid().
-- Every RLS policy that checks user_id = auth.uid() fails for those users because
-- auth.uid() is the Supabase auth UUID, not our users.id.
-- Magic-link login silently signs users out immediately after authentication.
--
-- Fix:
-- 1. Add auth_user_app_id() helper that maps auth.email() → users.id
-- 2. Update auth_user_role() and auth_user_sub_account() to use email lookup
-- 3. Recreate every RLS policy that compared against auth.uid() to use
--    public.auth_user_app_id() instead.

-- ── Helper functions ─────────────────────────────────────────────────────────

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

-- ── users table ──────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "users_select_same_sub_account" ON public.users;
DROP POLICY IF EXISTS "users_insert_admin"             ON public.users;
DROP POLICY IF EXISTS "users_update_own_or_admin"      ON public.users;
DROP POLICY IF EXISTS "users_delete_admin"             ON public.users;

CREATE POLICY "users_select_same_sub_account" ON public.users
  FOR SELECT USING (
    sub_account = public.auth_user_sub_account()
    OR public.auth_user_role() = 'Super-Admin'
  );

CREATE POLICY "users_insert_admin" ON public.users
  FOR INSERT WITH CHECK (
    public.auth_user_role() IN ('Admin', 'Super-Admin')
  );

CREATE POLICY "users_update_own_or_admin" ON public.users
  FOR UPDATE USING (
    id = public.auth_user_app_id()
    OR public.auth_user_role() IN ('Admin', 'Super-Admin')
  );

CREATE POLICY "users_delete_admin" ON public.users
  FOR DELETE USING (
    public.auth_user_role() IN ('Admin', 'Super-Admin')
  );

-- ── sub_accounts ─────────────────────────────────────────────────────────────
-- (auth_user_sub_account() now uses email — policies stay the same wording)

DROP POLICY IF EXISTS "sub_accounts_select"            ON public.sub_accounts;
DROP POLICY IF EXISTS "sub_accounts_write_super_admin" ON public.sub_accounts;

CREATE POLICY "sub_accounts_select" ON public.sub_accounts
  FOR SELECT USING (
    code = public.auth_user_sub_account()
    OR public.auth_user_role() = 'Super-Admin'
  );

CREATE POLICY "sub_accounts_write_super_admin" ON public.sub_accounts
  FOR ALL USING (public.auth_user_role() = 'Super-Admin')
  WITH CHECK (public.auth_user_role() = 'Super-Admin');

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

DROP POLICY IF EXISTS "screenshots_select" ON public.screenshots;
DROP POLICY IF EXISTS "screenshots_insert_own" ON public.screenshots;
DROP POLICY IF EXISTS "screenshots_delete" ON public.screenshots;

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

-- ── tasks ────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "tasks_select" ON public.tasks;
DROP POLICY IF EXISTS "tasks_insert" ON public.tasks;
DROP POLICY IF EXISTS "tasks_update" ON public.tasks;
DROP POLICY IF EXISTS "tasks_delete" ON public.tasks;

CREATE POLICY "tasks_select" ON public.tasks
  FOR SELECT USING (
    assignee_id = public.auth_user_app_id()
    OR creator_id = public.auth_user_app_id()
    OR public.auth_user_role() IN ('Admin', 'Manager', 'Super-Admin')
  );

CREATE POLICY "tasks_insert" ON public.tasks
  FOR INSERT WITH CHECK (
    creator_id = public.auth_user_app_id()
    OR public.auth_user_role() IN ('Admin', 'Manager', 'Super-Admin')
  );

CREATE POLICY "tasks_update" ON public.tasks
  FOR UPDATE USING (
    creator_id = public.auth_user_app_id()
    OR assignee_id = public.auth_user_app_id()
    OR public.auth_user_role() IN ('Admin', 'Manager', 'Super-Admin')
  );

CREATE POLICY "tasks_delete" ON public.tasks
  FOR DELETE USING (
    creator_id = public.auth_user_app_id()
    OR public.auth_user_role() IN ('Admin', 'Manager', 'Super-Admin')
  );

-- ── task_assignees ────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "task_assignees_select" ON public.task_assignees;
DROP POLICY IF EXISTS "task_assignees_insert" ON public.task_assignees;
DROP POLICY IF EXISTS "task_assignees_delete" ON public.task_assignees;
DROP POLICY IF EXISTS "task_assignees_write"  ON public.task_assignees;

CREATE POLICY "task_assignees_select" ON public.task_assignees
  FOR SELECT USING (
    user_id = public.auth_user_app_id()
    OR public.auth_user_role() IN ('Admin', 'Manager', 'Super-Admin')
  );

CREATE POLICY "task_assignees_write" ON public.task_assignees
  FOR ALL USING (
    public.auth_user_role() IN ('Admin', 'Manager', 'Super-Admin')
  );

-- ── task_comments ─────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "task_comments_select" ON public.task_comments;
DROP POLICY IF EXISTS "task_comments_insert" ON public.task_comments;

CREATE POLICY "task_comments_select" ON public.task_comments
  FOR SELECT USING (
    user_id = public.auth_user_app_id()
    OR public.auth_user_role() IN ('Admin', 'Manager', 'Super-Admin')
  );

CREATE POLICY "task_comments_insert" ON public.task_comments
  FOR INSERT WITH CHECK (user_id = public.auth_user_app_id());

-- ── leave_requests ────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "leave_select"          ON public.leave_requests;
DROP POLICY IF EXISTS "leave_insert_own"      ON public.leave_requests;
DROP POLICY IF EXISTS "leave_update_manager"  ON public.leave_requests;
DROP POLICY IF EXISTS "leaves_select"         ON public.leave_requests;
DROP POLICY IF EXISTS "leaves_update"         ON public.leave_requests;

CREATE POLICY "leaves_select" ON public.leave_requests
  FOR SELECT USING (
    user_id = public.auth_user_app_id()
    OR public.auth_user_role() IN ('Admin', 'Manager', 'Super-Admin')
  );

CREATE POLICY "leave_insert_own" ON public.leave_requests
  FOR INSERT WITH CHECK (user_id = public.auth_user_app_id());

CREATE POLICY "leaves_update" ON public.leave_requests
  FOR UPDATE USING (
    user_id = public.auth_user_app_id()
    OR public.auth_user_role() IN ('Admin', 'Manager', 'Super-Admin')
  );

-- ── notifications ─────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "notif_select"             ON public.notifications;
DROP POLICY IF EXISTS "notifications_select_own" ON public.notifications;
DROP POLICY IF EXISTS "notifications_update_own" ON public.notifications;
DROP POLICY IF EXISTS "notifications_insert"     ON public.notifications;

CREATE POLICY "notifications_select_own" ON public.notifications
  FOR SELECT USING (
    user_id = public.auth_user_app_id()
    OR public.auth_user_role() IN ('Admin', 'Manager', 'Super-Admin')
  );

CREATE POLICY "notifications_update_own" ON public.notifications
  FOR UPDATE USING (user_id = public.auth_user_app_id());

-- Any authenticated user can insert notifications (for cross-user task events)
CREATE POLICY "notifications_insert" ON public.notifications
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- ── eod_reports ───────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "eod_select"     ON public.eod_reports;
DROP POLICY IF EXISTS "eod_insert_own" ON public.eod_reports;

CREATE POLICY "eod_select" ON public.eod_reports
  FOR SELECT USING (
    user_id = public.auth_user_app_id()
    OR public.auth_user_role() IN ('Admin', 'Manager', 'Super-Admin')
  );

CREATE POLICY "eod_insert_own" ON public.eod_reports
  FOR INSERT WITH CHECK (user_id = public.auth_user_app_id());

-- ── kpis ─────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "kpis_select"   ON public.kpis;
DROP POLICY IF EXISTS "kpis_insert"   ON public.kpis;
DROP POLICY IF EXISTS "kpis_update"   ON public.kpis;
DROP POLICY IF EXISTS "kpis_delete"   ON public.kpis;
DROP POLICY IF EXISTS "kpis_write_own" ON public.kpis;

CREATE POLICY "kpis_select" ON public.kpis
  FOR SELECT USING (
    user_id = public.auth_user_app_id()
    OR public.auth_user_role() IN ('Admin', 'Manager', 'Super-Admin')
  );

CREATE POLICY "kpis_insert" ON public.kpis
  FOR INSERT WITH CHECK (
    public.auth_user_role() IN ('Admin', 'Manager', 'Super-Admin')
  );

CREATE POLICY "kpis_update" ON public.kpis
  FOR UPDATE USING (
    public.auth_user_role() IN ('Admin', 'Manager', 'Super-Admin')
  );

CREATE POLICY "kpis_delete" ON public.kpis
  FOR DELETE USING (
    public.auth_user_role() IN ('Admin', 'Manager', 'Super-Admin')
  );

-- ── kpi_daily_logs ────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "kpi_daily_logs_select" ON public.kpi_daily_logs;
DROP POLICY IF EXISTS "kpi_daily_logs_insert" ON public.kpi_daily_logs;
DROP POLICY IF EXISTS "kpi_daily_logs_update" ON public.kpi_daily_logs;

CREATE POLICY "kpi_daily_logs_select" ON public.kpi_daily_logs
  FOR SELECT USING (
    user_id = public.auth_user_app_id()
    OR public.auth_user_role() IN ('Admin', 'Manager', 'Super-Admin')
  );

CREATE POLICY "kpi_daily_logs_insert" ON public.kpi_daily_logs
  FOR INSERT WITH CHECK (user_id = public.auth_user_app_id());

CREATE POLICY "kpi_daily_logs_update" ON public.kpi_daily_logs
  FOR UPDATE USING (user_id = public.auth_user_app_id());

-- ── documents (DB table) ──────────────────────────────────────────────────────

DROP POLICY IF EXISTS "documents_select" ON public.documents;
DROP POLICY IF EXISTS "documents_insert" ON public.documents;
DROP POLICY IF EXISTS "documents_delete" ON public.documents;

CREATE POLICY "documents_select" ON public.documents
  FOR SELECT USING (
    user_id = public.auth_user_app_id()
    OR public.auth_user_role() IN ('Admin', 'Manager', 'Super-Admin')
  );

CREATE POLICY "documents_insert" ON public.documents
  FOR INSERT WITH CHECK (
    user_id = public.auth_user_app_id()
    OR public.auth_user_role() IN ('Admin', 'Manager', 'Super-Admin')
  );

CREATE POLICY "documents_delete" ON public.documents
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

-- ── storage.objects — documents ───────────────────────────────────────────────

DROP POLICY IF EXISTS "documents_upload" ON storage.objects;
DROP POLICY IF EXISTS "documents_read"   ON storage.objects;
DROP POLICY IF EXISTS "documents_delete" ON storage.objects;

CREATE POLICY "documents_upload" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'documents'
    AND (
      public.auth_user_app_id()::text = (storage.foldername(name))[1]
      OR public.auth_user_role() IN ('Admin', 'Manager', 'Super-Admin')
    )
  );

CREATE POLICY "documents_read" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'documents'
    AND (
      public.auth_user_app_id()::text = (storage.foldername(name))[1]
      OR public.auth_user_role() IN ('Admin', 'Manager', 'Super-Admin')
    )
  );

CREATE POLICY "documents_delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'documents'
    AND (
      public.auth_user_app_id()::text = (storage.foldername(name))[1]
      OR public.auth_user_role() IN ('Admin', 'Super-Admin')
    )
  );

-- ── storage.objects — avatars ────────────────────────────────────────────────

DROP POLICY IF EXISTS "avatars_public_read" ON storage.objects;
DROP POLICY IF EXISTS "avatars_upload"      ON storage.objects;

CREATE POLICY "avatars_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'avatars');

CREATE POLICY "avatars_upload" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'avatars'
    AND public.auth_user_app_id()::text = (storage.foldername(name))[1]
  );
