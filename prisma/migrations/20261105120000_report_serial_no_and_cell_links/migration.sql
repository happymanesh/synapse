-- Two report-engine display options, both additive and both defaulting to today's
-- behaviour so every existing report renders exactly as it did before.

-- A 1-based row number down the left of the results, numbering the rows as displayed
-- (after sorting and filtering) rather than carrying a value from the query. A report that
-- wants a stable identifier should select one as an ordinary column instead.
ALTER TABLE "report_definition" ADD COLUMN "show_serial_no" BOOLEAN NOT NULL DEFAULT false;

-- Renders a cell as a link into the application, e.g. '/support/tickets/{ticket_id}'.
-- Placeholders in braces are replaced with that row's value for the named column, so the
-- template can key off a column the report selects but does not display.
--
-- Distinct from the drill-down columns beside it: those open another REPORT, this opens an
-- app page. Keeping them separate means a column can do one without implying the other.
ALTER TABLE "report_column" ADD COLUMN "link_url_template" TEXT;
