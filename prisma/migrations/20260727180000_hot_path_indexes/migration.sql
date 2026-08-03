-- Indexes on the paths resolved on every request or that grow unbounded.
-- Postgres does not index foreign keys automatically, so without these the
-- per-request menu/app resolution degrades to sequential scans as data grows.

-- Hottest: role -> menu resolution runs on every page render.
CREATE INDEX IF NOT EXISTS "role_menu_map_company_code_hierarchy_code_role_code_idx"
    ON "role_menu_map" ("company_code", "hierarchy_code", "role_code");
CREATE INDEX IF NOT EXISTS "role_menu_map_menu_code_idx" ON "role_menu_map" ("menu_code");

CREATE INDEX IF NOT EXISTS "menu_master_app_code_idx" ON "menu_master" ("app_code");
CREATE INDEX IF NOT EXISTS "menu_master_parent_menu_code_idx" ON "menu_master" ("parent_menu_code");
CREATE INDEX IF NOT EXISTS "menu_master_company_code_hierarchy_code_idx"
    ON "menu_master" ("company_code", "hierarchy_code");

CREATE INDEX IF NOT EXISTS "notification_read_user_uid_idx" ON "notification_read" ("user_uid");
CREATE INDEX IF NOT EXISTS "notification_target_user_uid_idx" ON "notification" ("target_user_uid");
CREATE INDEX IF NOT EXISTS "notification_target_hierarchy_code_idx" ON "notification" ("target_hierarchy_code");

-- Audit/history tables: unbounded growth, always queried by user.
CREATE INDEX IF NOT EXISTS "login_logs_user_uid_idx" ON "login_logs" ("user_uid");
CREATE INDEX IF NOT EXISTS "user_ip_mapping_user_uid_idx" ON "user_ip_mapping" ("user_uid");
CREATE INDEX IF NOT EXISTS "password_history_user_uid_idx" ON "password_history" ("user_uid");

-- Report/filter engine child tables, loaded per report definition.
CREATE INDEX IF NOT EXISTS "report_column_report_id_idx" ON "report_column" ("report_id");
CREATE INDEX IF NOT EXISTS "report_row_highlight_rule_report_id_idx" ON "report_row_highlight_rule" ("report_id");
CREATE INDEX IF NOT EXISTS "filter_definition_item_filter_id_idx" ON "filter_definition_item" ("filter_id");

CREATE INDEX IF NOT EXISTS "user_details_company_code_idx" ON "user_details" ("company_code");
