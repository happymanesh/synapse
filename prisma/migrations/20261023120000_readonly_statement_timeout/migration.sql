-- Bound how long an administrator-authored report query may run.
--
-- Report SQL is stored in the database and executed dynamically. assertSelectOnly stops it
-- writing and the synapse_readonly role stops it writing structurally, but neither stops it
-- running forever: one accidental cross join pins a connection until someone notices.
-- A server-side timeout cannot be forgotten at a call site the way an application timeout can.
--
-- Guarded on the role existing, because DATABASE_URL_READONLY is optional — without the
-- guard this migration would fail every deploy in an environment that has no separate
-- read-only role. Those environments get no timeout and must set one themselves; see
-- CLAUDE.md. Idempotent, so re-running is safe.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'synapse_readonly') THEN
    EXECUTE 'ALTER ROLE synapse_readonly SET statement_timeout = ''30s''';
    -- A transaction left open holds locks and a connection just as effectively.
    EXECUTE 'ALTER ROLE synapse_readonly SET idle_in_transaction_session_timeout = ''60s''';
  END IF;
END
$$;
