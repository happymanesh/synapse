"use client";

import { useState } from "react";
import { alignmentForType, compareByType, formatCellByType, type ColumnDataType } from "@/lib/report-format";
import { useLanguage } from "@/lib/i18n";

export interface ReportColumnView {
  columnKey: string;
  displayLabel: string;
  displayOrder: number;
  isHighlighted: boolean;
  isIdentifier?: boolean;
  dataType?: string;
  decimalPlaces?: number | null;
  showTotal?: boolean;
  drillDownReportId?: string | null;
  drillDownTargetParam?: string | null;
  drillDownMode?: string | null;
  drillDownModalSize?: string | null;
}

export interface HighlightRuleView {
  columnKey: string;
  operator: string;
  compareValue: string;
  highlightColor: string;
  priority: number;
}

function matchesRule(row: Record<string, unknown>, rule: HighlightRuleView): boolean {
  const raw = row[rule.columnKey];
  const cell = raw === null || raw === undefined ? "" : String(raw);
  const cmp = rule.compareValue;
  switch (rule.operator) {
    case "EQ":
      return cell === cmp;
    case "NEQ":
      return cell !== cmp;
    case "GT":
      return Number(cell) > Number(cmp);
    case "LT":
      return Number(cell) < Number(cmp);
    case "GTE":
      return Number(cell) >= Number(cmp);
    case "LTE":
      return Number(cell) <= Number(cmp);
    case "CONTAINS":
      return cell.toLowerCase().includes(cmp.toLowerCase());
    default:
      return false;
  }
}

const FREEZE_COL_WIDTH = 160;
const ALIGN_CLASS: Record<"left" | "center" | "right", string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};

export default function ResultsTable({
  title,
  filterSummary,
  columns,
  rows,
  freezeColumns,
  displayStyle,
  footerNote,
  highlightRules = [],
  allowedFormats = [],
  onExport,
  rowActions,
  onDrillDown,
}: {
  title?: string;
  filterSummary?: string;
  columns: ReportColumnView[];
  rows: Record<string, unknown>[];
  freezeColumns: number;
  displayStyle: string;
  footerNote?: string | null;
  highlightRules?: HighlightRuleView[];
  allowedFormats?: string[];
  onExport?: (format: "CSV" | "PDF" | "EXCEL") => void;
  rowActions?: (row: Record<string, unknown>) => React.ReactNode;
  onDrillDown?: (column: ReportColumnView, row: Record<string, unknown>) => void;
}) {
  const { t } = useLanguage();
  const [page, setPage] = useState(1);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [showColumnFilter, setShowColumnFilter] = useState(false);
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [downloadOpen, setDownloadOpen] = useState(false);

  const pageSize = 50;
  const sortedColumns = [...columns].sort((a, b) => a.displayOrder - b.displayOrder);
  const isFullFrozen = displayStyle === "FULL_FROZEN";

  const dataTypeOf = (key: string): ColumnDataType => {
    const col = sortedColumns.find((c) => c.columnKey === key);
    return (col?.dataType as ColumnDataType) ?? "TEXT";
  };

  const filteredRows = Object.keys(filterValues).some((k) => filterValues[k])
    ? rows.filter((row) =>
        sortedColumns.every((c) => {
          const term = filterValues[c.columnKey]?.trim().toLowerCase();
          if (!term) return true;
          const display = formatCellByType(row[c.columnKey], dataTypeOf(c.columnKey), c.decimalPlaces).toLowerCase();
          return display.includes(term);
        })
      )
    : rows;

  const sortedRows = sortKey
    ? [...filteredRows].sort((a, b) => {
        const cmp = compareByType(a[sortKey], b[sortKey], dataTypeOf(sortKey));
        return sortDir === "asc" ? cmp : -cmp;
      })
    : filteredRows;

  const pagedRows = isFullFrozen ? sortedRows : sortedRows.slice((page - 1) * pageSize, page * pageSize);
  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));

  const totalsColumns = sortedColumns.filter((c) => c.showTotal);
  const columnTotal = (columnKey: string, decimalPlaces?: number | null): string => {
    const sum = filteredRows.reduce((acc, row) => acc + (Number(row[columnKey]) || 0), 0);
    return formatCellByType(sum, "NUMBER", decimalPlaces);
  };

  function rowHighlight(row: Record<string, unknown>): string | undefined {
    const matched = highlightRules.filter((r) => matchesRule(row, r)).sort((a, b) => b.priority - a.priority)[0];
    return matched?.highlightColor;
  }

  function toggleSort(columnKey: string) {
    if (sortKey === columnKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(columnKey);
      setSortDir("asc");
    }
    setPage(1);
  }

  const hasDownload = allowedFormats.length > 0 && !!onExport;
  const colSpan = sortedColumns.length + (rowActions ? 1 : 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-3">
        <div>
          {title && <h2 className="text-lg font-semibold text-foreground">{title}</h2>}
          {filterSummary && <p className="mt-0.5 text-xs text-foreground/60">{filterSummary}</p>}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowColumnFilter((v) => !v)}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground/80 hover:bg-surface"
          >
            {showColumnFilter ? t("hideColumnFilter") : t("columnFilter")}
          </button>
          {hasDownload && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setDownloadOpen((v) => !v)}
                className="btn-brand rounded-md px-3 py-1.5 text-xs font-medium hover:opacity-90"
              >
                {t("download")} ▾
              </button>
              {downloadOpen && (
                <div className="absolute right-0 z-20 mt-1 w-36 rounded-md border border-border bg-card p-1 shadow-lg">
                  <button
                    type="button"
                    disabled={!allowedFormats.includes("CSV")}
                    onClick={() => {
                      onExport?.("CSV");
                      setDownloadOpen(false);
                    }}
                    className="block w-full rounded-md px-3 py-1.5 text-left text-sm text-foreground/80 hover:bg-surface disabled:opacity-40"
                  >
                    CSV
                  </button>
                  <button
                    type="button"
                    disabled
                    title="Coming soon"
                    className="block w-full rounded-md px-3 py-1.5 text-left text-sm text-foreground/40"
                  >
                    PDF (coming soon)
                  </button>
                  <button
                    type="button"
                    disabled
                    title="Coming soon"
                    className="block w-full rounded-md px-3 py-1.5 text-left text-sm text-foreground/40"
                  >
                    Excel (coming soon)
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border bg-card shadow-sm">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="sticky top-0 z-10 bg-surface text-xs text-foreground/60 uppercase">
            <tr>
              {sortedColumns.map((c, i) => {
                const align = alignmentForType((c.dataType as ColumnDataType) ?? "TEXT");
                return (
                  <th
                    key={c.columnKey}
                    onClick={() => toggleSort(c.columnKey)}
                    className={[
                      "cursor-pointer border-b border-r border-border/60 px-3 py-2 font-medium select-none",
                      ALIGN_CLASS[align],
                      c.isHighlighted ? "bg-brand-teal/10" : "",
                      i < freezeColumns ? "sticky z-20 bg-surface" : "",
                    ].join(" ")}
                    style={i < freezeColumns ? { left: i * FREEZE_COL_WIDTH } : undefined}
                    title="Click to sort"
                  >
                    {c.displayLabel}
                    {sortKey === c.columnKey && <span className="ml-1">{sortDir === "asc" ? "▲" : "▼"}</span>}
                  </th>
                );
              })}
              {rowActions && <th className="border-b border-border/60 px-3 py-2 font-medium">{t("actions")}</th>}
            </tr>
            {showColumnFilter && (
              <tr>
                {sortedColumns.map((c) => (
                  <th key={`filter-${c.columnKey}`} className="border-b border-r border-border/60 bg-card p-1 font-normal normal-case">
                    <input
                      value={filterValues[c.columnKey] ?? ""}
                      onChange={(e) => {
                        setFilterValues((v) => ({ ...v, [c.columnKey]: e.target.value }));
                        setPage(1);
                      }}
                      placeholder={`${t("columnFilter")}…`}
                      className="w-full rounded border border-border bg-background px-2 py-1 text-xs outline-none focus:border-brand-navy"
                    />
                  </th>
                ))}
                {rowActions && <th className="border-b border-border/60 bg-card" />}
              </tr>
            )}
          </thead>
          <tbody>
            {pagedRows.length === 0 && (
              <tr>
                <td colSpan={colSpan || 1} className="px-3 py-6 text-center text-foreground/50">
                  {t("noRecordsYet")}
                </td>
              </tr>
            )}
            {pagedRows.map((row, ri) => {
              const highlight = rowHighlight(row);
              const stripeClass = highlight ? "" : ri % 2 === 0 ? "bg-card" : "bg-surface/50";
              return (
                <tr key={ri} className={`border-b border-border/60 ${stripeClass}`} style={highlight ? { backgroundColor: highlight } : undefined}>
                  {sortedColumns.map((c, i) => {
                    const dataType = (c.dataType as ColumnDataType) ?? "TEXT";
                    const align = alignmentForType(dataType);
                    const cellText = formatCellByType(row[c.columnKey], dataType, c.decimalPlaces);
                    const drillable = !!c.drillDownReportId && onDrillDown;
                    return (
                      <td
                        key={c.columnKey}
                        className={[
                          "border-r border-border/60 px-3 py-2",
                          ALIGN_CLASS[align],
                          c.isHighlighted ? "font-semibold" : "",
                          i < freezeColumns ? "sticky z-10" : "",
                        ].join(" ")}
                        style={
                          i < freezeColumns
                            ? { left: i * FREEZE_COL_WIDTH, backgroundColor: highlight ?? "var(--card)" }
                            : undefined
                        }
                      >
                        {drillable ? (
                          <button
                            type="button"
                            onClick={() => onDrillDown!(c, row)}
                            className="text-brand-navy underline-offset-2 hover:underline"
                          >
                            {cellText}
                          </button>
                        ) : (
                          cellText
                        )}
                      </td>
                    );
                  })}
                  {rowActions && <td className="border-r border-border/60 px-3 py-2">{rowActions(row)}</td>}
                </tr>
              );
            })}
          </tbody>
          {(totalsColumns.length > 0 || footerNote) && (
            <tfoot className="sticky bottom-0 bg-surface">
              {totalsColumns.length > 0 && (
                <tr className="border-t border-border/60 font-semibold text-foreground">
                  {sortedColumns.map((c, i) => (
                    <td
                      key={`total-${c.columnKey}`}
                      className={["border-r border-border/60 px-3 py-2", ALIGN_CLASS[alignmentForType((c.dataType as ColumnDataType) ?? "TEXT")]].join(" ")}
                    >
                      {c.showTotal
                        ? columnTotal(c.columnKey, c.decimalPlaces)
                        : i === 0
                          ? t("total")
                          : ""}
                    </td>
                  ))}
                  {rowActions && <td className="border-r border-border/60 px-3 py-2" />}
                </tr>
              )}
              {footerNote && (
                <tr>
                  <td colSpan={colSpan || 1} className="px-3 py-2 text-xs text-foreground/60">
                    {footerNote}
                  </td>
                </tr>
              )}
            </tfoot>
          )}
        </table>
      </div>
      <div className="flex shrink-0 items-center justify-between text-sm text-foreground/60">
        <span>
          {sortedRows.length === 0
            ? t("noRecords")
            : isFullFrozen
              ? `${sortedRows.length} ${t("records")}`
              : `${Math.min((page - 1) * pageSize + 1, sortedRows.length)}–${Math.min(page * pageSize, sortedRows.length)} / ${sortedRows.length}`}
        </span>
        {!isFullFrozen && (
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="rounded-md border border-border px-3 py-1 disabled:opacity-40"
            >
              {t("previous")}
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-md border border-border px-3 py-1 disabled:opacity-40"
            >
              {t("next")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
