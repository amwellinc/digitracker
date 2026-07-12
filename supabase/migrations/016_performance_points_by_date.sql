-- Migration 016: Change performance_points from weekly to daily entries
--
-- Before: one entry per (user_id, week_start) — manager rates the whole week at once
-- After:  one entry per (user_id, date)        — manager rates any specific day
-- Weekly total in KPI indicators = SUM of all daily entries in that Mon–Fri range

-- Drop old unique constraint on (user_id, week_start)
ALTER TABLE public.performance_points
  DROP CONSTRAINT IF EXISTS performance_points_user_id_week_start_key;

-- Rename column week_start → date
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'performance_points' AND column_name = 'week_start'
  ) THEN
    ALTER TABLE public.performance_points RENAME COLUMN week_start TO date;
  END IF;
END $$;

-- Add new unique constraint: one rating per user per calendar day
ALTER TABLE public.performance_points
  DROP CONSTRAINT IF EXISTS performance_points_user_id_date_key;

ALTER TABLE public.performance_points
  ADD CONSTRAINT performance_points_user_id_date_key UNIQUE (user_id, date);
