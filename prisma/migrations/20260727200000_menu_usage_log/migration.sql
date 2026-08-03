-- Append-only menu selection log, retained 7 days.
-- No foreign keys on purpose: this table is written from the click path, so inserts
-- should not pay for constraint checks, and rows must outlive the menus/users they name.
CREATE TABLE IF NOT EXISTS "menu_usage_log" (
    "id"           SERIAL       NOT NULL,
    "user_uid"     INTEGER      NOT NULL,
    "username"     TEXT         NOT NULL,
    "company_code" TEXT         NOT NULL,
    "app_code"     TEXT,
    "menu_code"    TEXT         NOT NULL,
    "menu_name"    TEXT         NOT NULL,
    "main_menu"    TEXT,
    "sub_menu"     TEXT,
    "route_path"   TEXT,
    "selected_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "menu_usage_log_pkey" PRIMARY KEY ("id")
);

-- Drives both the 7-day purge and the "last 7 days" top-N read.
CREATE INDEX IF NOT EXISTS "menu_usage_log_selected_at_idx" ON "menu_usage_log" ("selected_at");
CREATE INDEX IF NOT EXISTS "menu_usage_log_user_uid_selected_at_idx" ON "menu_usage_log" ("user_uid", "selected_at");
