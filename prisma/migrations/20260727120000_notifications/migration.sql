-- Documents tables created directly via psql (not through `prisma migrate
-- dev`/`db push`), because those commands want to drop the unmanaged
-- `sample_sales` table to reconcile drift. See CLAUDE.md.

CREATE TABLE IF NOT EXISTS "notification" (
  "id" SERIAL PRIMARY KEY,
  "sender_uid" INTEGER NOT NULL REFERENCES "user_details"("uid"),
  "target_type" TEXT NOT NULL,
  "target_hierarchy_code" TEXT NULL REFERENCES "hierarchy_master"("hierarchy_code"),
  "target_user_uid" INTEGER NULL REFERENCES "user_details"("uid"),
  "delivery_popup" BOOLEAN NOT NULL DEFAULT false,
  "delivery_bell" BOOLEAN NOT NULL DEFAULT true,
  "message_text" TEXT NOT NULL,
  "scheduled_for" TIMESTAMP(3) NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "is_active" BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS "notification_read" (
  "id" SERIAL PRIMARY KEY,
  "notification_id" INTEGER NOT NULL REFERENCES "notification"("id") ON DELETE CASCADE,
  "user_uid" INTEGER NOT NULL REFERENCES "user_details"("uid") ON DELETE CASCADE,
  "read_at" TIMESTAMP(3) NOT NULL DEFAULT now(),
  CONSTRAINT "notification_read_notification_id_user_uid_key" UNIQUE ("notification_id", "user_uid")
);
