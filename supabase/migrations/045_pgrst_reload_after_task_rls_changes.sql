-- Migration 045: Force PostgREST to reload after the tasks RLS changes.
--
-- debug_try_task_insert proved the real bug is gone: an actual INSERT with
-- real RLS, using the exact creator_id/assignee_id from a failed app
-- request, succeeds. pg_policies confirms the correct policy is live. Yet
-- the app's own REST request to POST /rest/v1/tasks still gets rejected
-- with the pre-fix behavior.
--
-- Same root cause as the earlier "Could not find the 'remarks' column of
-- 'leave_requests' in the schema cache" incident (migration 037): PostgREST
-- caches schema/connection state and doesn't always pick up a DDL change
-- (there, a column; here, a policy replacement) until explicitly told to
-- reload. A direct RPC call and a raw catalog read both bypass that cache;
-- the app's auto-generated REST endpoint does not.

notify pgrst, 'reload schema';
