-- Employee profile on Synapse users + first-login password change (decided 2026-10-07).
--
-- employee_code is the cross-system key: workPulse links its users to employees by it (it
-- used to link by email, which breaks on team-shared mailboxes). Mandatory for every NEW user
-- (enforced by userCreateSchema); nullable here only because existing rows predate it.
--
-- reporting_manager_code is the manager's employee code. Spine does not send a manager yet:
-- until it does, an administrator may set it (source ADMIN); once the HR sync has a value it
-- takes over (source HR), except for users marked hr_manually_managed.
--
-- must_change_password forces a password change at the next sign-in. Set for every new user,
-- whether created by an administrator or provisioned from HR.
--
-- Applied by hand, not through `prisma migrate dev` / `db push`. See CLAUDE.md.

ALTER TABLE "user_details"
    ADD COLUMN IF NOT EXISTS "employee_code"            TEXT,
    ADD COLUMN IF NOT EXISTS "designation"              TEXT,
    ADD COLUMN IF NOT EXISTS "department"               TEXT,
    ADD COLUMN IF NOT EXISTS "reporting_manager_code"   TEXT,
    ADD COLUMN IF NOT EXISTS "reporting_manager_source" TEXT,   -- ADMIN | HR
    ADD COLUMN IF NOT EXISTS "must_change_password"     BOOLEAN NOT NULL DEFAULT false;

-- Case-insensitive uniqueness, matching how usernames are compared at login.
CREATE UNIQUE INDEX IF NOT EXISTS "user_details_employee_code_key"
    ON "user_details" (lower("employee_code"));

-- The HR side of the manager: null for Spine until the vendor adds the field.
ALTER TABLE "hr_employee"
    ADD COLUMN IF NOT EXISTS "reporting_manager_code" TEXT;
