-- Split the single ticket category into three independent axes: type, application, segment.
--
-- Applied by hand, not through `prisma migrate dev` / `db push`. See CLAUDE.md.
--
-- Existing tickets are backfilled from their retired category before the new columns are
-- tightened, so this applies to a populated database as well as an empty one.
--
-- The baseline application/segment rows are inserted HERE rather than left to the seed:
-- the seed runs after migrate deploy, so a backfill that depended on it would have nothing
-- to point at.

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

-- Baseline reference data. ON CONFLICT DO NOTHING so this is a no-op where the seed has
-- already created them; the seed upserts the same codes.
INSERT INTO "application_master" ("code", "name", "display_order") VALUES
  ('TRADING-TERMINAL', 'Trading Terminal', 10),
  ('MOBILE-APP',       'Mobile App',       20),
  ('WEBSITE',          'Website',          30),
  ('BACK-OFFICE',      'Back Office',      40),
  ('RMS',              'RMS',              50),
  ('PAYMENTS',         'Payments & Funds', 60),
  ('KYC-ONBOARDING',   'KYC & Onboarding', 70),
  ('SYNAPSE',          'Synapse',          80)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "segment_master" ("code", "name", "display_order") VALUES
  ('EQ-CASH',     'Equity Cash',              10),
  ('EQ-FNO',      'Equity Derivatives (F&O)', 20),
  ('CURRENCY',    'Currency Derivatives',     30),
  ('COMMODITY',   'Commodity',                40),
  ('MUTUAL-FUND', 'Mutual Funds',             50),
  ('IPO',         'IPO',                      60),
  ('NA',          'Not Applicable',          900)
ON CONFLICT ("code") DO NOTHING;

ALTER TABLE "ticket" ADD COLUMN IF NOT EXISTS "ticket_type" TEXT;
ALTER TABLE "ticket" ADD COLUMN IF NOT EXISTS "type_other" TEXT;
ALTER TABLE "ticket" ADD COLUMN IF NOT EXISTS "application_id" INTEGER
    REFERENCES "application_master" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ticket" ADD COLUMN IF NOT EXISTS "segment_id" INTEGER
    REFERENCES "segment_master" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill existing tickets from the category they were filed under, so the classification
-- they already carry survives the split rather than being flattened to a default.
UPDATE "ticket" t SET "ticket_type" = COALESCE((
  SELECT CASE c."issue_type"
           WHEN 'BUG'             THEN 'BUG'
           WHEN 'COMPLAINT'       THEN 'COMPLAINT'
           WHEN 'SERVICE_REQUEST' THEN 'REQUEST'
           WHEN 'QUERY'           THEN 'CLARIFICATION'
           ELSE 'ISSUE'
         END
  FROM "issue_category" c WHERE c."category_code" = t."category_code"
), 'ISSUE')
WHERE t."ticket_type" IS NULL;

-- The old product/module maps onto an application by name where one lines up; anything
-- unrecognised falls to Synapse rather than blocking the migration.
UPDATE "ticket" t SET "application_id" = COALESCE(
  (SELECT a."id" FROM "issue_category" c JOIN "application_master" a ON a."name" = c."product_module"
   WHERE c."category_code" = t."category_code"),
  (SELECT "id" FROM "application_master" WHERE "code" = 'SYNAPSE'),
  (SELECT "id" FROM "application_master" ORDER BY "display_order", "id" LIMIT 1))
WHERE t."application_id" IS NULL;

-- The old taxonomy had no segment axis, but two of its product modules were really
-- segments wearing the wrong hat: "Equities" and "Derivatives" describe what was traded,
-- not which system was used. Mapping those across preserves information that would
-- otherwise be thrown away; everything else honestly gets "Not Applicable" rather than a
-- guess that would read like real data.
UPDATE "ticket" t SET "segment_id" = COALESCE(
  (SELECT s."id" FROM "issue_category" c, "segment_master" s
   WHERE c."category_code" = t."category_code"
     AND ((c."product_module" = 'Equities'    AND s."code" = 'EQ-CASH')
       OR (c."product_module" = 'Derivatives' AND s."code" = 'EQ-FNO'))),
  (SELECT "id" FROM "segment_master" WHERE "code" = 'NA'),
  (SELECT "id" FROM "segment_master" ORDER BY "display_order", "id" LIMIT 1))
WHERE t."segment_id" IS NULL;

-- Now safe to tighten. SET NOT NULL still fails loudly if the backfill missed anything,
-- which is the protection that matters.
ALTER TABLE "ticket" ALTER COLUMN "ticket_type"    SET NOT NULL;
ALTER TABLE "ticket" ALTER COLUMN "application_id" SET NOT NULL;
ALTER TABLE "ticket" ALTER COLUMN "segment_id"     SET NOT NULL;

CREATE INDEX IF NOT EXISTS "ticket_application_id_ticket_type_status_raised_at_idx"
    ON "ticket" ("application_id", "ticket_type", "status", "raised_at");
CREATE INDEX IF NOT EXISTS "ticket_segment_id_idx" ON "ticket" ("segment_id");
