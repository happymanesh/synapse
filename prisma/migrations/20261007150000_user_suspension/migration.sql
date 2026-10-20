-- Account suspension: a restorable block, separate from deactivation (decided 2026-10-07).
--
--   is_active = false   permanent: the person has left. Never restored by HR data.
--   is_suspended = true temporary: e.g. HR has frozen the employee in Spine. Login and every
--                       request refuse the account (accountBlock() in src/lib/auth-core.ts),
--                       but it comes back when the suspension is lifted.
--
-- suspended_by records who set it. The HR lifecycle sets 'HR_SYNC' and only ever lifts a
-- suspension it set itself — a suspension placed by an administrator is never lifted
-- automatically.
--
-- Applied by hand, not through `prisma migrate dev` / `db push`. See CLAUDE.md.

ALTER TABLE "user_details"
    ADD COLUMN IF NOT EXISTS "is_suspended"     BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "suspended_at"     TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "suspended_by"     TEXT,
    ADD COLUMN IF NOT EXISTS "suspended_reason" TEXT;

-- hr_lifecycle_action.action gains SUSPEND | UNSUSPEND (free text column; no DDL needed).
