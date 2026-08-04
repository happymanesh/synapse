-- Opt-in company scoping for REPORT mode.
-- When set, the engine wraps the report's query with a predicate binding the column to the
-- caller's company, mirroring how FORM mode enforces record ownership.
ALTER TABLE "report_definition" ADD COLUMN IF NOT EXISTS "company_scope_column" TEXT;
