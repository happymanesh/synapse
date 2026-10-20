-- HR integration, phase 1. Two processes, deliberately disconnected:
--
--   A. HR ingestion (source-specific; Spine today, SIHL's own HR system later)
--        hr_ingest_run -> hr_raw_employee -> curation -> hr_employee (+ hr_employee_change)
--      Code: src/lib/hr/ingest. Run: npm run hr:ingest.
--
--   B. Synapse lifecycle (source-agnostic)
--        hr_employee -> decide -> user_details (+ hr_lifecycle_action)
--      Code: src/lib/hr/lifecycle. Run: npm run hr:lifecycle.
--
-- hr_employee is the only contract between them. B never reads raw rows, run rows or
-- anything Spine-specific, so replacing Spine means writing a new ingestion adapter that
-- fills hr_employee — B is unchanged.
--
-- Applied by hand, not through `prisma migrate dev` / `db push`. See CLAUDE.md.
--
-- Data minimisation: Spine sends ~130 fields per employee, including caste, religion,
-- disability, bank account, PAN and Aadhaar. Only 11 are ever stored, even in the raw
-- table — they are selected in memory before the first insert (src/lib/hr/ingest/spine-core.ts,
-- SPINE_FIELDS). There is deliberately no jsonb/"payload" column anywhere below.

-- ===========================================================================
-- A. HR ingestion
-- ===========================================================================

-- One row per invocation, so a missed night is visible and every raw row traces to a run.
-- All-or-nothing: if any fetch fails, curation does not run and hr_employee is untouched.
CREATE TABLE IF NOT EXISTS "hr_ingest_run" (
    "id"            SERIAL       NOT NULL,
    "source_system" TEXT         NOT NULL,               -- SPINE
    "req_types"     TEXT         NOT NULL,               -- what was fetched, e.g. Created,Modified
    "req_date"      DATE         NOT NULL,
    "started_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at"   TIMESTAMP(3),
    "status"        TEXT         NOT NULL DEFAULT 'RUNNING', -- RUNNING | SUCCEEDED | FAILED
    -- Reconciliation counts only (received/accepted/rejected/inserted/updated/...). No PII.
    "summary"       JSONB,
    -- Sanitised before storing: Spine echoes the client key back in its error text.
    "error"         TEXT,

    CONSTRAINT "hr_ingest_run_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "hr_ingest_run_req_date_idx" ON "hr_ingest_run" ("source_system", "req_date");

-- Landing table: the 11 fields exactly as the source sent them — unparsed text, bad dates
-- and all — so curation and reconciliation can be checked against what actually arrived.
-- Short-lived: rows older than HR_RAW_RETENTION_DAYS are purged at the start of each run.
CREATE TABLE IF NOT EXISTS "hr_raw_employee" (
    "id"                  BIGSERIAL    NOT NULL,
    "run_id"              INTEGER      NOT NULL REFERENCES "hr_ingest_run" ("id") ON DELETE CASCADE,
    "req_type"            TEXT         NOT NULL,         -- which request returned it (Created | Modified)
    "record_no"           INTEGER      NOT NULL,         -- position within the run
    "employee_code"       TEXT,
    "old_employee_code"   TEXT,
    "company_code"        TEXT,
    "first_name"          TEXT,
    "last_name"           TEXT,
    "email"               TEXT,
    "mobile"              TEXT,
    "branch"              TEXT,
    "department"          TEXT,
    "status"              TEXT,
    "last_working_date"   TEXT,                          -- raw, e.g. 2079-08-18T00:00:00
    "received_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "curation_status"     TEXT         NOT NULL DEFAULT 'PENDING', -- PENDING | ACCEPTED | WARNED | REJECTED | SUPERSEDED
    "curation_notes"      TEXT,

    CONSTRAINT "hr_raw_employee_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "hr_raw_employee_run_idx" ON "hr_raw_employee" ("run_id", "curation_status");
CREATE INDEX IF NOT EXISTS "hr_raw_employee_received_idx" ON "hr_raw_employee" ("received_at");

-- Canonical employee: curated, source-neutral. One row per source employment record.
-- A move between group companies is two Spine records — the old one Resigned, the new one
-- Active with Old_Employee_Code pointing back — and stays two rows here, linked by
-- previous_source_employee_id (observed 2026-10-07: all 19 such records cross companies).
CREATE TABLE IF NOT EXISTS "hr_employee" (
    "id"                          SERIAL       NOT NULL,
    "source_system"               TEXT         NOT NULL,
    "source_employee_id"          TEXT         NOT NULL,
    "previous_source_employee_id" TEXT,
    "source_company_code"         TEXT,
    "first_name"                  TEXT,
    "last_name"                   TEXT,
    "email"                       TEXT,
    "mobile"                      TEXT,
    "branch"                      TEXT,
    "department"                  TEXT,
    "source_status"               TEXT,                  -- as the source labels it
    "employment_status"           TEXT         NOT NULL, -- ACTIVE | INACTIVE | UNKNOWN
    -- NULL = not leaving. Source placeholders (Spine's 2079) are curated to NULL.
    "last_working_date"           DATE,
    "last_working_date_invalid"   BOOLEAN      NOT NULL DEFAULT false,
    -- Recorded only; never changes access. NULL = source does not report leave (Spine today).
    "on_leave"                    BOOLEAN,
    "first_seen_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at"                TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_changed_at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_run_id"                 INTEGER      REFERENCES "hr_ingest_run" ("id") ON DELETE SET NULL,

    CONSTRAINT "hr_employee_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "hr_employee_source_key" ON "hr_employee" ("source_system", "source_employee_id");

-- Field-level history of hr_employee, written by ingestion: the audit and reconciliation
-- trail — what changed, when, from which run.
CREATE TABLE IF NOT EXISTS "hr_employee_change" (
    "id"              BIGSERIAL    NOT NULL,
    "hr_employee_id"  INTEGER      NOT NULL REFERENCES "hr_employee" ("id") ON DELETE CASCADE,
    "run_id"          INTEGER      REFERENCES "hr_ingest_run" ("id") ON DELETE SET NULL,
    "change_type"     TEXT         NOT NULL,             -- FIRST_SEEN | FIELD_CHANGED
    "field"           TEXT,
    "old_value"       TEXT,
    "new_value"       TEXT,
    "detected_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hr_employee_change_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "hr_employee_change_emp_idx" ON "hr_employee_change" ("hr_employee_id", "detected_at");
CREATE INDEX IF NOT EXISTS "hr_employee_change_run_idx" ON "hr_employee_change" ("run_id");

-- ===========================================================================
-- B. Synapse lifecycle
-- ===========================================================================

-- The link from a Synapse user to a canonical employee record — not customer_id, and not a
-- source code (a source code is not portable across HR systems). On a company move an admin
-- re-points it to the new record (lifecycle queues that as a review).
ALTER TABLE "user_details" ADD COLUMN IF NOT EXISTS "hr_employee_id" INTEGER
    REFERENCES "hr_employee" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS "user_details_hr_employee_id_key" ON "user_details" ("hr_employee_id");

-- Manual override wins: a user flagged here is never changed by the lifecycle process.
ALTER TABLE "user_details" ADD COLUMN IF NOT EXISTS "hr_manually_managed" BOOLEAN NOT NULL DEFAULT false;

-- Every decision the lifecycle process acts on: applied (deactivation) or queued for review.
CREATE TABLE IF NOT EXISTS "hr_lifecycle_action" (
    "id"              SERIAL       NOT NULL,
    "hr_employee_id"  INTEGER      NOT NULL REFERENCES "hr_employee" ("id") ON DELETE RESTRICT,
    "user_uid"        INTEGER      REFERENCES "user_details" ("uid") ON DELETE RESTRICT ON UPDATE CASCADE,
    "action"          TEXT         NOT NULL,             -- DEACTIVATE | REVIEW
    "status"          TEXT         NOT NULL,             -- APPLIED | PENDING_REVIEW | RESOLVED | DISMISSED
    "reason"          TEXT         NOT NULL,
    "effective_date"  DATE,
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_by"     TEXT,
    "resolved_at"     TIMESTAMP(3),

    CONSTRAINT "hr_lifecycle_action_pkey" PRIMARY KEY ("id")
);
-- At most one open review per employee, so a nightly run does not re-queue it every night.
CREATE UNIQUE INDEX IF NOT EXISTS "hr_lifecycle_action_open_key"
    ON "hr_lifecycle_action" ("hr_employee_id", "action")
    WHERE "status" = 'PENDING_REVIEW';
CREATE INDEX IF NOT EXISTS "hr_lifecycle_action_status_idx" ON "hr_lifecycle_action" ("status", "created_at");

-- Admin-editable HR Branch/Department -> Synapse company + hierarchy. Never inferred: menu
-- grants are hierarchy-filtered, so a fuzzy match would silently change what a user can
-- see. Matching is exact after trim + case-fold; hr_department NULL = any department in the
-- branch, and an exact department row wins. Used by joiner provisioning (phase two).
CREATE TABLE IF NOT EXISTS "hr_branch_hierarchy_map" (
    "id"                   SERIAL       NOT NULL,
    "hr_company_code"      TEXT         NOT NULL,        -- source company, e.g. Spine C006
    "hr_branch"            TEXT         NOT NULL,
    "hr_department"        TEXT,
    "company_code"         TEXT         NOT NULL REFERENCES "company_master" ("company_code") ON DELETE RESTRICT ON UPDATE CASCADE,
    "hierarchy_code"       TEXT         NOT NULL REFERENCES "hierarchy_master" ("hierarchy_code") ON DELETE RESTRICT ON UPDATE CASCADE,
    "is_active"            BOOLEAN      NOT NULL DEFAULT true,
    "created_by"           TEXT         NOT NULL,
    "updated_by"           TEXT,
    "updated_on"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hr_branch_hierarchy_map_pkey" PRIMARY KEY ("id")
);
-- Prisma cannot express this; COALESCE makes the "any department" row unique per branch too.
CREATE UNIQUE INDEX IF NOT EXISTS "hr_branch_hierarchy_map_key" ON "hr_branch_hierarchy_map" (
    lower(trim("hr_company_code")),
    lower(trim("hr_branch")),
    COALESCE(lower(trim("hr_department")), '')
);
