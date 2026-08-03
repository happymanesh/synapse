-- Applied manually via psql to avoid Prisma's drift-reset flow (the DB has an
-- unmanaged sample_sales table created by the dynamic report engine's seed
-- script, which migrate dev/db push would otherwise want to drop). Recorded
-- here so migration history matches the live schema.
ALTER TABLE "report_column" ADD COLUMN IF NOT EXISTS "data_type" TEXT NOT NULL DEFAULT 'TEXT';
ALTER TABLE "report_column" ADD COLUMN IF NOT EXISTS "decimal_places" INTEGER;
