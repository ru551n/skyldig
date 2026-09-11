-- Operator admin app support. Privacy first: the admin app's database role gets no access to
-- any table in `public` — only to the aggregate views and the three narrow functions below, all
-- in the `admin` schema. None of them returns a group's name, participants, expenses, notes or
-- history. Views and SECURITY DEFINER functions run with their owner's privileges (the app's own
-- role), which is how they can read the tables the admin role cannot.
CREATE SCHEMA IF NOT EXISTS admin;
--> statement-breakpoint
REVOKE ALL ON SCHEMA admin FROM PUBLIC;
--> statement-breakpoint
CREATE TABLE admin.audit_log (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  actor text NOT NULL,
  action text NOT NULL,
  target text,
  detail text
);
--> statement-breakpoint
CREATE INDEX audit_log_at_idx ON admin.audit_log (at);
--> statement-breakpoint
-- One row per cleanup run, written by the app's scheduler (server/modules/expiration/cleanup.ts).
CREATE TABLE admin.maintenance_runs (
  id bigserial PRIMARY KEY,
  started_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL DEFAULT now(),
  trigger text NOT NULL CHECK (trigger IN ('schedule', 'admin')),
  actor text,
  sessions_deleted integer NOT NULL,
  browser_sessions_deleted integer NOT NULL,
  invites_deleted integer NOT NULL,
  skipped boolean NOT NULL
);
--> statement-breakpoint
CREATE INDEX maintenance_runs_started_at_idx ON admin.maintenance_runs (started_at);
--> statement-breakpoint
-- "Run cleanup now" files a request here; the app's scheduler notices it within a minute and runs
-- its normal cleanup. The admin role therefore never needs DELETE rights on any table.
CREATE TABLE admin.cleanup_requests (
  id bigserial PRIMARY KEY,
  requested_at timestamptz NOT NULL DEFAULT now(),
  requested_by text NOT NULL,
  handled_at timestamptz
);
--> statement-breakpoint
CREATE VIEW admin.overview AS
SELECT
  (SELECT count(*) FROM public.sessions WHERE expires_at > now()) AS active_groups,
  (SELECT count(*) FROM public.sessions WHERE created_at > now() - interval '1 day') AS groups_created_1d,
  (SELECT count(*) FROM public.sessions WHERE created_at > now() - interval '7 days') AS groups_created_7d,
  (SELECT count(*) FROM public.sessions WHERE created_at > now() - interval '30 days') AS groups_created_30d,
  (SELECT count(*) FROM public.sessions
     WHERE expires_at > now() AND expires_at <= now() + interval '7 days') AS groups_expiring_7d,
  (SELECT count(*) FROM public.participants p
     JOIN public.sessions s ON s.id = p.session_id WHERE s.expires_at > now()) AS participants_active,
  (SELECT count(DISTINCT browser_session_id) FROM public.session_grants) AS browsers_joined,
  (SELECT count(*) FROM public.browser_sessions
     WHERE last_seen_at > now() - interval '30 days') AS browsers_active_30d,
  (SELECT count(*) FROM public.expenses) AS expenses_total,
  (SELECT count(*) FROM public.expenses WHERE created_at > now() - interval '30 days') AS expenses_30d,
  (SELECT count(*) FROM public.expenses WHERE currency_code <> base_currency_code) AS expenses_foreign,
  (SELECT count(*) FROM public.payments) AS payments_total,
  (SELECT count(*) FROM public.session_invites
     WHERE used_at IS NULL AND revoked_at IS NULL AND expires_at > now()) AS open_invites,
  pg_database_size(current_database()) AS database_bytes;
--> statement-breakpoint
CREATE VIEW admin.daily_activity AS
SELECT
  d.day,
  (SELECT count(*) FROM public.sessions s WHERE s.created_at::date = d.day) AS groups_created,
  (SELECT count(*) FROM public.expenses e WHERE e.created_at::date = d.day) AS expenses_created,
  (SELECT count(*) FROM public.payments p WHERE p.created_at::date = d.day) AS payments_created,
  (SELECT count(*) FROM public.session_grants g WHERE g.created_at::date = d.day) AS joins
FROM (SELECT generate_series(current_date - 29, current_date, interval '1 day')::date AS day) d
ORDER BY d.day;
--> statement-breakpoint
CREATE VIEW admin.group_sizes AS
SELECT bucket, count(*) AS groups
FROM (
  SELECT
    CASE WHEN n <= 2 THEN '1–2' WHEN n = 3 THEN '3' WHEN n = 4 THEN '4' WHEN n <= 8 THEN '5–8' ELSE '9+' END AS bucket,
    CASE WHEN n <= 2 THEN 1 WHEN n = 3 THEN 2 WHEN n = 4 THEN 3 WHEN n <= 8 THEN 4 ELSE 5 END AS ord
  FROM (
    SELECT s.id, count(p.id) AS n
    FROM public.sessions s LEFT JOIN public.participants p ON p.session_id = s.id
    WHERE s.expires_at > now()
    GROUP BY s.id
  ) sized
) bucketed
GROUP BY bucket, ord
ORDER BY ord;
--> statement-breakpoint
CREATE VIEW admin.currency_mix AS
SELECT base_currency AS currency, count(*) AS groups
FROM public.sessions
WHERE expires_at > now()
GROUP BY base_currency
ORDER BY groups DESC, currency;
--> statement-breakpoint
CREATE VIEW admin.recent_runs AS
SELECT started_at, finished_at, trigger, actor, sessions_deleted, browser_sessions_deleted, invites_deleted, skipped
FROM admin.maintenance_runs
ORDER BY started_at DESC
LIMIT 50;
--> statement-breakpoint
CREATE VIEW admin.recent_audit AS
SELECT at, actor, action, target, detail
FROM admin.audit_log
ORDER BY at DESC
LIMIT 200;
--> statement-breakpoint
CREATE VIEW admin.cleanup_status AS
SELECT
  (SELECT min(requested_at) FROM admin.cleanup_requests WHERE handled_at IS NULL) AS pending_since,
  (SELECT max(finished_at) FROM admin.maintenance_runs) AS last_run_at;
--> statement-breakpoint
-- Dates and counts for one group, looked up by the public ID from a reported link — never its
-- name or anything its members wrote.
CREATE FUNCTION admin.group_metadata(p_public_id text)
RETURNS TABLE (
  created_at timestamptz,
  expires_at timestamptz,
  participants bigint,
  expenses bigint,
  payments bigint,
  last_activity timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT
    s.created_at,
    s.expires_at,
    (SELECT count(*) FROM public.participants WHERE session_id = s.id),
    (SELECT count(*) FROM public.expenses WHERE session_id = s.id),
    (SELECT count(*) FROM public.payments WHERE session_id = s.id),
    (SELECT max(r.created_at) FROM public.revisions r WHERE r.session_id = s.id)
  FROM public.sessions s
  WHERE s.public_id = p_public_id;
$$;
--> statement-breakpoint
-- Deletes one group (everything in it cascades) and records who did it and why.
CREATE FUNCTION admin.delete_group(p_public_id text, p_actor text, p_reason text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  deleted integer;
BEGIN
  IF coalesce(btrim(p_actor), '') = '' OR coalesce(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'actor and reason are required';
  END IF;
  DELETE FROM public.sessions WHERE public_id = p_public_id;
  GET DIAGNOSTICS deleted = ROW_COUNT;
  IF deleted > 0 THEN
    INSERT INTO admin.audit_log (actor, action, target, detail)
    VALUES (left(p_actor, 200), 'delete_group', p_public_id, left(p_reason, 500));
  END IF;
  RETURN deleted > 0;
END;
$$;
--> statement-breakpoint
-- Asks the app to run its cleanup soon. At most one request is outstanding at a time.
CREATE FUNCTION admin.request_cleanup(p_actor text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF coalesce(btrim(p_actor), '') = '' THEN
    RAISE EXCEPTION 'actor is required';
  END IF;
  IF EXISTS (SELECT 1 FROM admin.cleanup_requests WHERE handled_at IS NULL) THEN
    RETURN false;
  END IF;
  INSERT INTO admin.cleanup_requests (requested_by) VALUES (left(p_actor, 200));
  INSERT INTO admin.audit_log (actor, action) VALUES (left(p_actor, 200), 'request_cleanup');
  RETURN true;
END;
$$;
--> statement-breakpoint
-- New functions are executable by PUBLIC by default in PostgreSQL; these must not be.
REVOKE ALL ON FUNCTION admin.group_metadata(text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION admin.delete_group(text, text, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION admin.request_cleanup(text) FROM PUBLIC;
--> statement-breakpoint
-- Everything the admin role may touch, in one place. Called below when the role already exists,
-- and by server/tools/setup-db.ts when it creates the role on an install that migrated earlier.
CREATE FUNCTION admin.apply_admin_grants(p_role text)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  EXECUTE format('GRANT USAGE ON SCHEMA admin TO %I', p_role);
  EXECUTE format(
    'GRANT SELECT ON admin.overview, admin.daily_activity, admin.group_sizes, admin.currency_mix, '
    'admin.recent_runs, admin.recent_audit, admin.cleanup_status TO %I',
    p_role
  );
  EXECUTE format(
    'GRANT EXECUTE ON FUNCTION admin.group_metadata(text), admin.delete_group(text, text, text), '
    'admin.request_cleanup(text) TO %I',
    p_role
  );
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION admin.apply_admin_grants(text) FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'skyldig_admin') THEN
    PERFORM admin.apply_admin_grants('skyldig_admin');
  END IF;
END;
$$;
