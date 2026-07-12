-- Migration 015: KPI Performance Points + EOD Rows Structure
--
-- 1. Add eod_rows (jsonb) to kpi_daily_logs — structured EOD table instead of free-text notes
-- 2. Add checklist_remarks (jsonb) to kpi_daily_logs — per-item text remarks alongside checkbox
-- 3. Create performance_points table — manager assigns weekly -10 to +10 score per staff member

ALTER TABLE public.kpi_daily_logs
  ADD COLUMN IF NOT EXISTS eod_rows jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS checklist_remarks jsonb NOT NULL DEFAULT '[]';

CREATE TABLE IF NOT EXISTS public.performance_points (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  manager_id  uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  week_start  date NOT NULL,
  points      integer NOT NULL CHECK (points BETWEEN -10 AND 10),
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, week_start)
);

ALTER TABLE public.performance_points ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "perf_points_select" ON public.performance_points;
CREATE POLICY "perf_points_select" ON public.performance_points
  FOR SELECT USING (
    user_id = public.auth_user_app_id()
    OR public.auth_user_role() IN ('Admin', 'Manager', 'Super-Admin')
  );

DROP POLICY IF EXISTS "perf_points_write" ON public.performance_points;
CREATE POLICY "perf_points_write" ON public.performance_points
  FOR ALL USING (
    public.auth_user_role() IN ('Admin', 'Manager', 'Super-Admin')
  ) WITH CHECK (
    public.auth_user_role() IN ('Admin', 'Manager', 'Super-Admin')
  );
