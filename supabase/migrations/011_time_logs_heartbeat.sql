-- Migration 011: Add last_seen_at to time_logs for stale-session detection
-- Heartbeat updates this every 2 min while clocked in.
-- On app load, any active log with last_seen_at > 10 min ago is auto-clocked-out.
alter table public.time_logs
  add column if not exists last_seen_at timestamptz;
