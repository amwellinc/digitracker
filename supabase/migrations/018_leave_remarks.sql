-- Add remarks column to leave_requests so managers can attach a note
-- when approving or rejecting a leave application.

alter table public.leave_requests
  add column if not exists remarks text;
