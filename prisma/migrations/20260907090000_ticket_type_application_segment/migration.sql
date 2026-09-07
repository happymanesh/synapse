-- Split the single ticket category into three independent axes: type, application, segment.
--
-- Applied by hand, not through `prisma migrate dev` / `db push`. See CLAUDE.md.
--
-- Safe to run because no tickets exist in any environment yet: the three new columns are
-- added nullable and then tightened to NOT NULL, which would fail on a populated table.
-- If this is ever run against a database holding tickets, backfill first.

CREATE TABLE IF NOT EXISTS "application_master" (
    "id"            SERIAL  NOT NULL,
    "code"          TEXT    NOT NULL UNIQUE,
    "name"          TEXT    NOT NULL,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "is_active"     BOOLEAN NOT NULL DEFAULT true,
    -- Who added it, since the raise screen can create one inline.
    "created_by"    TEXT,

    CONSTRAINT "application_master_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "segment_master" (
    "id"            SERIAL  NOT NULL,
    "code"          TEXT    NOT NULL UNIQUE,
    "name"          TEXT    NOT NULL,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "is_active"     BOOLEAN NOT NULL DEFAULT true,
    "created_by"    TEXT,

    CONSTRAINT "segment_master_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "application_master_is_active_display_order_idx"
    ON "application_master" ("is_active", "display_order");
CREATE INDEX IF NOT EXISTS "segment_master_is_active_display_order_idx"
    ON "segment_master" ("is_active", "display_order");

-- The old combined category is superseded, not deleted: the column stays so any historical
-- classification remains readable, but it no longer has to be supplied.
ALTER TABLE "ticket" ALTER COLUMN "category_code" DROP NOT NULL;

ALTER TABLE "ticket" ADD COLUMN IF NOT EXISTS "ticket_type" TEXT;
ALTER TABLE "ticket" ADD COLUMN IF NOT EXISTS "type_other" TEXT;
ALTER TABLE "ticket" ADD COLUMN IF NOT EXISTS "application_id" INTEGER
    REFERENCES "application_master" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ticket" ADD COLUMN IF NOT EXISTS "segment_id" INTEGER
    REFERENCES "segment_master" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Only tighten once the table is known to be empty of unclassified rows, so re-running this
-- on a database that has since been populated fails loudly instead of silently corrupting.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "ticket"
    WHERE "ticket_type" IS NULL OR "application_id" IS NULL OR "segment_id" IS NULL
  ) THEN
    ALTER TABLE "ticket" ALTER COLUMN "ticket_type"    SET NOT NULL;
    ALTER TABLE "ticket" ALTER COLUMN "application_id" SET NOT NULL;
    ALTER TABLE "ticket" ALTER COLUMN "segment_id"     SET NOT NULL;
  ELSE
    RAISE EXCEPTION 'ticket rows exist without type/application/segment — backfill before applying';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "ticket_application_id_ticket_type_status_raised_at_idx"
    ON "ticket" ("application_id", "ticket_type", "status", "raised_at");
CREATE INDEX IF NOT EXISTS "ticket_segment_id_idx" ON "ticket" ("segment_id");
