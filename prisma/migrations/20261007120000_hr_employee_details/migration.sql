-- HR integration: 32 more Spine fields (decided 2026-10-07), recorded for reporting only.
-- Nothing here changes access: the lifecycle process does not read these columns.
--
-- Groups: employment dates and exit (10), job and organisation (11), statutory
-- applicability as Yes/No flags only (5), HR administration groups (6).
--
-- Still never stored: personal/family details, disability, government IDs, bank/salary/tax,
-- addresses, personal contacts (see SPINE_FIELD_MAP in src/lib/hr/ingest/spine-core.ts).
--
-- leaving_reason and frozen_reason are HR free text and may hold sensitive detail — expose
-- them to HR/admin roles only.
--
-- Applied by hand, not through `prisma migrate dev` / `db push`. See CLAUDE.md.

-- ---------------------------------------------------------------------------
-- hr_raw_employee: as received (text)
-- ---------------------------------------------------------------------------
ALTER TABLE "hr_raw_employee"
    ADD COLUMN IF NOT EXISTS "join_date"               TEXT,
    ADD COLUMN IF NOT EXISTS "group_join_date"         TEXT,
    ADD COLUMN IF NOT EXISTS "confirm_date"            TEXT,
    ADD COLUMN IF NOT EXISTS "probation_date"          TEXT,
    ADD COLUMN IF NOT EXISTS "fnf_retiring_date"       TEXT,
    ADD COLUMN IF NOT EXISTS "resign_offer_date"       TEXT,
    ADD COLUMN IF NOT EXISTS "reason_for_leaving"      TEXT,
    ADD COLUMN IF NOT EXISTS "freeze_account"          TEXT,
    ADD COLUMN IF NOT EXISTS "freeze_date"             TEXT,
    ADD COLUMN IF NOT EXISTS "freeze_reason"           TEXT,
    ADD COLUMN IF NOT EXISTS "designation"             TEXT,
    ADD COLUMN IF NOT EXISTS "division"                TEXT,
    ADD COLUMN IF NOT EXISTS "unit"                    TEXT,
    ADD COLUMN IF NOT EXISTS "grade"                   TEXT,
    ADD COLUMN IF NOT EXISTS "employee_type"           TEXT,
    ADD COLUMN IF NOT EXISTS "job_post_code"           TEXT,
    ADD COLUMN IF NOT EXISTS "project"                 TEXT,
    ADD COLUMN IF NOT EXISTS "professional_employee"   TEXT,
    ADD COLUMN IF NOT EXISTS "user_group"              TEXT,
    ADD COLUMN IF NOT EXISTS "is_international"        TEXT,
    ADD COLUMN IF NOT EXISTS "education_qualification" TEXT,
    ADD COLUMN IF NOT EXISTS "pf_flag"                 TEXT,
    ADD COLUMN IF NOT EXISTS "esic_flag"               TEXT,
    ADD COLUMN IF NOT EXISTS "pt_flag"                 TEXT,
    ADD COLUMN IF NOT EXISTS "lwf_manager"             TEXT,
    ADD COLUMN IF NOT EXISTS "lwf_supervisor"          TEXT,
    ADD COLUMN IF NOT EXISTS "attendance_group"        TEXT,
    ADD COLUMN IF NOT EXISTS "leave_group"             TEXT,
    ADD COLUMN IF NOT EXISTS "expense_group"           TEXT,
    ADD COLUMN IF NOT EXISTS "time_sheet_group"        TEXT,
    ADD COLUMN IF NOT EXISTS "pms_group"               TEXT,
    ADD COLUMN IF NOT EXISTS "add_on_service_group"    TEXT;

-- ---------------------------------------------------------------------------
-- hr_employee: curated, typed, source-neutral names
-- ---------------------------------------------------------------------------
ALTER TABLE "hr_employee"
    -- Employment dates and exit
    ADD COLUMN IF NOT EXISTS "join_date"               DATE,
    ADD COLUMN IF NOT EXISTS "group_join_date"         DATE,
    ADD COLUMN IF NOT EXISTS "confirmation_date"       DATE,
    ADD COLUMN IF NOT EXISTS "probation_date"          DATE,
    ADD COLUMN IF NOT EXISTS "retirement_date"         DATE,   -- projected superannuation date
    ADD COLUMN IF NOT EXISTS "resignation_date"        DATE,
    ADD COLUMN IF NOT EXISTS "leaving_reason"          TEXT,   -- free text: HR/admin only
    ADD COLUMN IF NOT EXISTS "account_frozen"          BOOLEAN,
    ADD COLUMN IF NOT EXISTS "frozen_date"             DATE,
    ADD COLUMN IF NOT EXISTS "frozen_reason"           TEXT,   -- free text: HR/admin only
    -- Job and organisation
    ADD COLUMN IF NOT EXISTS "designation"             TEXT,
    ADD COLUMN IF NOT EXISTS "division"                TEXT,
    ADD COLUMN IF NOT EXISTS "unit"                    TEXT,
    ADD COLUMN IF NOT EXISTS "grade"                   TEXT,
    ADD COLUMN IF NOT EXISTS "employee_type"           TEXT,
    ADD COLUMN IF NOT EXISTS "job_post_code"           TEXT,
    ADD COLUMN IF NOT EXISTS "project"                 TEXT,
    ADD COLUMN IF NOT EXISTS "is_professional"         BOOLEAN,
    ADD COLUMN IF NOT EXISTS "user_group"              TEXT,
    ADD COLUMN IF NOT EXISTS "is_international"        BOOLEAN,
    ADD COLUMN IF NOT EXISTS "education_qualification" TEXT,
    -- Statutory applicability (flags only; no registration numbers)
    ADD COLUMN IF NOT EXISTS "pf_applicable"           BOOLEAN,
    ADD COLUMN IF NOT EXISTS "esic_applicable"         BOOLEAN,
    ADD COLUMN IF NOT EXISTS "pt_applicable"           BOOLEAN,
    ADD COLUMN IF NOT EXISTS "lwf_manager"             BOOLEAN, -- Labour Welfare Fund flag, not a person
    ADD COLUMN IF NOT EXISTS "lwf_supervisor"          BOOLEAN, -- Labour Welfare Fund flag, not a person
    -- HR administration groups
    ADD COLUMN IF NOT EXISTS "attendance_group"        TEXT,
    ADD COLUMN IF NOT EXISTS "leave_group"             TEXT,
    ADD COLUMN IF NOT EXISTS "expense_group"           TEXT,
    ADD COLUMN IF NOT EXISTS "timesheet_group"         TEXT,
    ADD COLUMN IF NOT EXISTS "pms_group"               TEXT,
    ADD COLUMN IF NOT EXISTS "add_on_service_group"    TEXT;

-- hr_employee_change.change_type gains BACKFILLED: values filled in for the first time when
-- these columns are populated from data Spine already sent, so the history does not read as
-- 557 people changing on one day.
