-- Manual "Sync from HR" (Administration > HR Sync) and the last working date on users.
--
-- hr_sync_job: one row per press of the button — who started it, which phase it is in, and
-- the counts shown on screen when it finishes. Distinct from hr_ingest_run (one row per Spine
-- date fetched): one job may fetch several dates while it catches up.
--
-- user_details.last_working_date: the one HR field the sync writes onto an existing user
-- (with deactivation, suspension on freeze, and creating new joiners). Everything else on
-- User Master belongs to administrators and department heads and is never overwritten by
-- the sync (SIHL, 2026-10-22).
--
-- Applied by hand, not through `prisma migrate dev` / `db push`. See CLAUDE.md.

ALTER TABLE "user_details" ADD COLUMN IF NOT EXISTS "last_working_date" DATE;

CREATE TABLE IF NOT EXISTS "hr_sync_job" (
    "id"           SERIAL       NOT NULL,
    "status"       TEXT         NOT NULL DEFAULT 'RUNNING',  -- RUNNING | SUCCEEDED | FAILED
    "phase"        TEXT,                                      -- FETCHING | APPLYING | DONE
    "started_by"   TEXT         NOT NULL,
    "started_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at"  TIMESTAMP(3),
    -- Counts only (fetched / new / changed / resigned / users added / deactivated / ...).
    -- Never names or contacts: this is shown on an admin screen and kept indefinitely.
    "summary"      JSONB,
    "error"        TEXT,

    CONSTRAINT "hr_sync_job_pkey" PRIMARY KEY ("id")
);

-- One job at a time: a second press while one is running is refused by the database, not
-- only by the button being disabled.
CREATE UNIQUE INDEX IF NOT EXISTS "hr_sync_job_one_running"
    ON "hr_sync_job" ((true)) WHERE "status" = 'RUNNING';
CREATE INDEX IF NOT EXISTS "hr_sync_job_started_idx" ON "hr_sync_job" ("started_at" DESC);
