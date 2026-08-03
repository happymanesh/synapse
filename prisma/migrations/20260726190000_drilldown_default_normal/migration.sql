-- Documents a change applied directly via psql (not through `prisma migrate
-- dev`/`db push`), because those commands want to drop the unmanaged
-- `sample_sales` table to reconcile drift. See CLAUDE.md.

-- "Normal" (a full report page with a back link) is now the default drill-down
-- display instead of "Popup" — existing rows with an explicit value are unaffected.
ALTER TABLE "report_column" ALTER COLUMN "drill_down_mode" SET DEFAULT 'PAGE';
