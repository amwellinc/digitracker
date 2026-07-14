-- Migration 020: Prevent duplicate active sessions
-- A user should never have more than one active (working/lunch) session per day.
-- Clean up any existing duplicates first, then add a partial unique index.

-- Step 1: Close duplicate active sessions, keeping the most recent clock_in per user/day
-- The older duplicate is closed at its own clock_in time with 0 minutes.
UPDATE public.time_logs
SET status = 'clocked_out',
    clock_out = clock_in,
    total_minutes = 0
WHERE id IN (
  SELECT id FROM (
    SELECT id,
      ROW_NUMBER() OVER (
        PARTITION BY user_id, date
        ORDER BY clock_in DESC
      ) AS rn
    FROM public.time_logs
    WHERE status IN ('working', 'lunch')
  ) ranked
  WHERE rn > 1
);

-- Step 2: Unique partial index — only one active session per user per day
CREATE UNIQUE INDEX IF NOT EXISTS time_logs_one_active_per_user_day
  ON public.time_logs (user_id, date)
  WHERE status IN ('working', 'lunch');
