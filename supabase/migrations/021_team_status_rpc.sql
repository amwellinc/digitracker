-- Migration 021: Reliable team status via SECURITY DEFINER RPC
-- Bypasses RLS to guarantee admin/manager always sees correct live team data.
-- Eliminates the user_id mismatch issue where staff active sessions were invisible
-- to the admin's two-step query (users → .in('user_id', ids) → time_logs).

CREATE OR REPLACE FUNCTION public.get_team_status(
  p_sub_account text,
  p_date        date
)
RETURNS TABLE (
  user_id      uuid,
  name         text,
  email        text,
  role         text,
  sub_account  text,
  profile_image text,
  log_status   text,
  clock_in     timestamptz,
  last_seen_at timestamptz,
  completed_mins integer
)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_caller_role        text;
  v_caller_sub_account text;
BEGIN
  -- Resolve caller identity
  SELECT u.role, u.sub_account
    INTO v_caller_role, v_caller_sub_account
    FROM public.users u
   WHERE LOWER(u.email) = LOWER(auth.email())
   LIMIT 1;

  -- Must be a privileged role
  IF v_caller_role NOT IN ('Admin', 'Manager', 'Super-Admin') THEN
    RAISE EXCEPTION 'Access denied: insufficient role';
  END IF;

  -- Non-super-admins can only query their own sub_account
  IF v_caller_role != 'Super-Admin' AND v_caller_sub_account != p_sub_account THEN
    RAISE EXCEPTION 'Access denied: sub_account mismatch';
  END IF;

  RETURN QUERY
  SELECT
    u.id                                              AS user_id,
    u.name,
    u.email,
    u.role,
    u.sub_account,
    u.profile_image,
    act.status                                        AS log_status,
    act.clock_in,
    act.last_seen_at,
    COALESCE((
      SELECT SUM(done.total_minutes)::integer
        FROM public.time_logs done
       WHERE done.user_id = u.id
         AND done.date    = p_date
         AND done.status  = 'clocked_out'
    ), 0)                                             AS completed_mins
  FROM public.users u
  LEFT JOIN LATERAL (
    SELECT tl.status, tl.clock_in, tl.last_seen_at
      FROM public.time_logs tl
     WHERE tl.user_id = u.id
       AND tl.date    = p_date
       AND tl.status IN ('working', 'lunch')
     LIMIT 1
  ) act ON true
  WHERE u.sub_account = p_sub_account
  ORDER BY u.name;
END;
$$;

-- Any authenticated user can call this; the function enforces role/sub_account checks internally
GRANT EXECUTE ON FUNCTION public.get_team_status(text, date) TO authenticated;
