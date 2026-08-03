-- Documents schema changes applied directly via psql (not through `prisma migrate
-- dev`/`db push`), because those commands want to drop the unmanaged `sample_sales`
-- table to reconcile drift. See CLAUDE.md.

-- Drill-down: a column can open another report, passing its cell value into a
-- target filter param, optionally as a full page (with a back link) or a sized modal.
ALTER TABLE "report_column"
  ADD COLUMN IF NOT EXISTS "drill_down_report_id" TEXT NULL,
  ADD COLUMN IF NOT EXISTS "drill_down_target_param" TEXT NULL,
  ADD COLUMN IF NOT EXISTS "drill_down_mode" TEXT NOT NULL DEFAULT 'MODAL',
  ADD COLUMN IF NOT EXISTS "drill_down_modal_size" TEXT NOT NULL DEFAULT 'AUTO';

ALTER TABLE "report_column"
  ADD CONSTRAINT "report_column_drill_down_report_id_fkey"
  FOREIGN KEY ("drill_down_report_id") REFERENCES "report_definition"("report_id")
  ON UPDATE CASCADE ON DELETE SET NULL;
