-- Documents schema changes that were applied directly via psql (not through
-- `prisma migrate dev`/`db push`), because those commands wanted to drop the
-- unmanaged `sample_sales` table to reconcile drift. See CLAUDE.md.

-- Per-column footer totals, configurable in the Report Master (ReportColumn.showTotal).
ALTER TABLE "report_column" ADD COLUMN IF NOT EXISTS "show_total" BOOLEAN NOT NULL DEFAULT false;

-- A user's favorited menu items (heart icon in the top bar / dashboard cards).
CREATE TABLE IF NOT EXISTS "user_favorite_menu" (
  "id" SERIAL PRIMARY KEY,
  "user_uid" INTEGER NOT NULL,
  "menu_code" TEXT NOT NULL,
  "created_on" TIMESTAMP(3) NOT NULL DEFAULT now(),
  CONSTRAINT "user_favorite_menu_user_uid_menu_code_key" UNIQUE ("user_uid", "menu_code"),
  CONSTRAINT "user_favorite_menu_user_uid_fkey" FOREIGN KEY ("user_uid") REFERENCES "user_details"("uid") ON DELETE CASCADE,
  CONSTRAINT "user_favorite_menu_menu_code_fkey" FOREIGN KEY ("menu_code") REFERENCES "menu_master"("menu_code") ON DELETE CASCADE
);
