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

-- Tighten to NOT NULL. Plain statements rather than a DO block guarding on row counts:
-- SET NOT NULL already fails loudly if any row holds a null, which is exactly the
-- protection the guard was written for. The DO block also carried a real cost — its body
-- contains semicolons inside dollar quotes, which `prisma db execute` (used locally, and
-- which sends the file whole) tolerates but `prisma migrate deploy` does not parse the same
-- way. That difference is what made this migration pass locally and fail in production.
ALTER TABLE "ticket" ALTER COLUMN "ticket_type"    SET NOT NULL;
ALTER TABLE "ticket" ALTER COLUMN "application_id" SET NOT NULL;
ALTER TABLE "ticket" ALTER COLUMN "segment_id"     SET NOT NULL;

CREATE INDEX IF NOT EXISTS "ticket_application_id_ticket_type_status_raised_at_idx"
    ON "ticket" ("application_id", "ticket_type", "status", "raised_at");
CREATE INDEX IF NOT EXISTS "ticket_segment_id_idx" ON "ticket" ("segment_id");
