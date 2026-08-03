"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import DynamicFilterField, { type FilterItemView, type SelectOption } from "./DynamicFilterField";
import ResultsTable, { type ReportColumnView, type HighlightRuleView } from "./ResultsTable";
import DrillDownModal from "./DrillDownModal";
import { useSidebarControl } from "@/components/app-shell/sidebar-control";
import { formatDate } from "@/lib/report-format";
import { useLanguage } from "@/lib/i18n";

/**
 * Resolves which of the target report's filter items should receive the clicked
 * cell's value. Most columns just name one param directly (e.g. "SALES_PRODUCT").
 * A column whose meaning depends on another filter in *this* report (e.g. a
 * summary report's single "Product / Region" column) instead stores a JSON
 * discriminator map: {"__discriminator":"SALES_SUMMARY_TYPE","PRODUCT":"SALES_DETAIL_PRODUCT",
 * "REGION":"SALES_DETAIL_REGION"} — the current value of SALES_SUMMARY_TYPE picks
 * which target param the cell's value actually goes into. See CLAUDE.md.
 */
function resolveDrillTargetParam(raw: string, currentValues: Record<string, string>): string | null {
  if (!raw.trim().startsWith("{")) return raw;
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    const discriminator = parsed.__discriminator;
    if (!discriminator) return null;
    const key = currentValues[discriminator];
    return parsed[key] ?? null;
  } catch {
    return null;
  }
}

/**
 * Universal date-range sanity check, not specific to any one report: "from" can't
 * be in the future, and "to" must come strictly after "from". Enforced here (not
 * just via the input's min/max attrs) since those can be bypassed by typing a date
 * directly.
 */
function validateDateRanges(items: FilterItemView[], values: Record<string, string>): string | null {
  const today = new Date().toISOString().slice(0, 10);
  for (const item of items) {
    if (item.component.componentType !== "DATE_RANGE") continue;
    const [from, to] = (values[item.componentCode] ?? "").split(",");
    const label = item.labelOverride ?? item.component.componentName;
    if (from && from > today) {
      return `${label}: the "from" date cannot be in the future.`;
    }
    if (from && to && to <= from) {
      return `${label}: the "to" date must be after the "from" date.`;
    }
  }
  return null;
}

/** Small "filters applied" summary line shown under the report title in the results header. */
function buildFilterSummary(items: FilterItemView[], values: Record<string, string>): string {
  const parts: string[] = [];
  for (const item of items) {
    const raw = values[item.componentCode];
    if (!raw) continue;
    const label = item.labelOverride ?? item.component.componentName;
    if (item.component.componentType === "DATE_RANGE") {
      const [from, to] = raw.split(",");
      if (!from && !to) continue;
      parts.push(`${label}: ${from ? formatDate(from) : "…"} – ${to ? formatDate(to) : "…"}`);
    } else if (item.component.componentType === "DATE") {
      parts.push(`${label}: ${formatDate(raw)}`);
    } else {
      parts.push(`${label}: ${raw}`);
    }
  }
  return parts.length > 0 ? parts.join("   •   ") : "No filters applied";
}

interface RunResult {
  rows: Record<string, unknown>[];
  columns: ReportColumnView[];
  highlightRules?: HighlightRuleView[];
  freezeColumns: number;
  displayStyle: string;
  footerNote: string | null;
  total?: number;
}

export default function ReportRunner({
  reportId,
  reportTitle,
  mode,
  isCollapsible,
  defaultCollapsed,
  items,
  allowedFormats,
  initialValues,
  autoShow,
  backLink,
  onResultLoaded,
  breadcrumb,
  isEmbeddedInModal,
}: {
  reportId: string;
  reportTitle: string;
  mode: "REPORT" | "FORM";
  isCollapsible: boolean;
  defaultCollapsed: boolean;
  items: FilterItemView[];
  allowedFormats: string[];
  /** Drill-down landing: pre-fills these filter values (only keys matching this report's own items apply). */
  initialValues?: Record<string, string>;
  /** Drill-down landing: runs Show automatically once, using the merged initial values. */
  autoShow?: boolean;
  /** Drill-down landing (PAGE mode): renders a "← Back to X" button using browser history. */
  backLink?: { label: string };
  /** Lets DrillDownModal auto-size itself once this instance's own result loads. */
  onResultLoaded?: (info: { columns: number; rows: number }) => void;
  /** This report's position in the menu tree, e.g. ["Utilities", "Sample", "Sales Report"] — shown above the filter section. */
  breadcrumb?: string[];
  /** True only when rendered inside DrillDownModal — that instance isn't the routed page, so it must never touch the URL. */
  isEmbeddedInModal?: boolean;
}) {
  const { t } = useLanguage();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { collapseSidebar } = useSidebarControl();
  const [collapsed, setCollapsed] = useState(defaultCollapsed || !!autoShow);
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const item of items) initial[item.componentCode] = item.defaultValue ?? "";
    return { ...initial, ...initialValues };
  });
  const [dynamicOptions, setDynamicOptions] = useState<Record<number, SelectOption[]>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [exceeded, setExceeded] = useState<{ total: number; maxRows: number; message: string } | null>(null);
  const [editingRecordId, setEditingRecordId] = useState<string | number | null>(null);
  const [drillModal, setDrillModal] = useState<{ reportId: string; values: Record<string, string>; size: string } | null>(null);

  const grouped = new Map<number, FilterItemView[]>();
  for (const item of items) {
    if (!grouped.has(item.rowNo)) grouped.set(item.rowNo, []);
    grouped.get(item.rowNo)!.push(item);
  }
  const sortedRows = Array.from(grouped.entries()).sort((a, b) => a[0] - b[0]);

  async function loadRecords() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/reports/${reportId}/records`);
      const data = await res.json();
      if (res.ok) setResult(data);
      else setError(data.error ?? "Unable to load your records.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (mode === "FORM") {
      // One-time load of the user's saved records on mount for FORM mode.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadRecords();
    } else if (autoShow) {
      // Drill-down landing: run once with the initial values already merged into state.
      handleShow();
    }

    // Standalone SQL-sourced dropdowns (no dependsOnItemId) need their options
    // loaded up front — only *dependent* children get (re)fetched reactively
    // when their parent's value changes.
    const independentSqlItems = items.filter((i) => i.component.dataSourceType === "SQL" && !i.dependsOnItemId);
    for (const item of independentSqlItems) {
      fetch(`/api/reports/${reportId}/filter-options/${item.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentValue: null }),
      })
        .then((res) => res.json())
        .then((data) => {
          setDynamicOptions((prev) => ({ ...prev, [item.id]: data.options ?? [] }));
        })
        .catch(() => {
          setDynamicOptions((prev) => ({ ...prev, [item.id]: [] }));
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleFieldChange(item: FilterItemView, newValue: string) {
    setValues((v) => ({ ...v, [item.componentCode]: newValue }));

    const children = items.filter((i) => i.dependsOnItemId === item.id);
    for (const child of children) {
      setValues((v) => ({ ...v, [child.componentCode]: "" }));
      if (child.component.dataSourceType === "SQL") {
        try {
          const res = await fetch(`/api/reports/${reportId}/filter-options/${child.id}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ parentValue: newValue || null }),
          });
          const data = await res.json();
          setDynamicOptions((prev) => ({ ...prev, [child.id]: data.options ?? [] }));
        } catch {
          setDynamicOptions((prev) => ({ ...prev, [child.id]: [] }));
        }
      }
    }
  }

  function handleReset() {
    const initial: Record<string, string> = {};
    for (const item of items) initial[item.componentCode] = item.defaultValue ?? "";
    setValues(initial);
    setExceeded(null);
    setError(null);
    setEditingRecordId(null);
    if (mode === "REPORT") setResult(null);
  }

  async function handleShow() {
    const validationError = validateDateRanges(items, values);
    if (validationError) {
      setError(validationError);
      return;
    }
    setLoading(true);
    setError(null);
    setExceeded(null);
    try {
      const res = await fetch(`/api/reports/${reportId}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Unable to run this report.");
        return;
      }
      if (data.exceeded) {
        setExceeded({ total: data.total, maxRows: data.maxRows, message: data.message });
        setResult(null);
        return;
      }
      setResult(data);
      onResultLoaded?.({ columns: data.columns?.length ?? 0, rows: data.rows?.length ?? 0 });
      if (isCollapsible) setCollapsed(true);
      collapseSidebar();
      // Record the shown filter values in this report's own URL (preserving any
      // existing params, e.g. drillFrom/drillFromTitle) so that navigating back to
      // it from a PAGE-mode drill-down restores this exact state instead of a blank
      // form — router.back() re-mounts the page fresh, so the state has to live in
      // the URL, not just in this component's memory. Skipped for DrillDownModal's
      // nested instance, which isn't the routed page and must never touch the URL.
      if (!isEmbeddedInModal) {
        const params = new URLSearchParams(searchParams.toString());
        for (const item of items) {
          const v = values[item.componentCode];
          if (v) params.set(item.componentCode, v);
          else params.delete(item.componentCode);
        }
        const qs = params.toString();
        router.replace(`/reports/${reportId}${qs ? `?${qs}` : ""}`, { scroll: false });
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function handleDrillDown(column: ReportColumnView, row: Record<string, unknown>) {
    if (!column.drillDownReportId) return;
    const rawParam = column.drillDownTargetParam ?? "";
    const targetParam = resolveDrillTargetParam(rawParam, values);
    if (!targetParam) return;

    const cellValue = row[column.columnKey];
    const targetValues: Record<string, string> = {
      ...values,
      [targetParam]: cellValue === null || cellValue === undefined ? "" : String(cellValue),
    };

    if (column.drillDownMode === "PAGE") {
      const qs = new URLSearchParams(targetValues);
      qs.set("drillFrom", reportId);
      qs.set("drillFromTitle", reportTitle);
      router.push(`/reports/${column.drillDownReportId}?${qs.toString()}`);
    } else {
      setDrillModal({ reportId: column.drillDownReportId, values: targetValues, size: column.drillDownModalSize ?? "AUTO" });
    }
  }

  async function handleSave() {
    const validationError = validateDateRanges(items, values);
    if (validationError) {
      setError(validationError);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/reports/${reportId}/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recordId: editingRecordId, values }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Unable to save.");
        return;
      }
      handleReset();
      await loadRecords();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function handleEdit(row: Record<string, unknown>) {
    const newValues: Record<string, string> = {};
    for (const item of items) {
      if (item.mappedColumn && row[item.mappedColumn] !== undefined) {
        newValues[item.componentCode] = String(row[item.mappedColumn] ?? "");
      }
    }
    setValues(newValues);
    const idCol = result?.columns.find((c) => c.isIdentifier)?.columnKey;
    setEditingRecordId(idCol ? (row[idCol] as string | number) : null);
    setCollapsed(false);
    setError(null);
  }

  async function handleDelete(row: Record<string, unknown>) {
    const idCol = result?.columns.find((c) => c.isIdentifier)?.columnKey;
    if (!idCol) return;
    const id = row[idCol];
    if (!confirm("Delete this record? This cannot be undone.")) return;
    const res = await fetch(`/api/reports/${reportId}/records/${id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.error ?? "Unable to delete this record.");
      return;
    }
    await loadRecords();
  }

  function handleExport() {
    window.location.href = `/api/reports/${reportId}/export?values=${encodeURIComponent(JSON.stringify(values))}`;
  }

  // A report reached via drill-down (backLink present, or embedded in DrillDownModal)
  // already has its filter values resolved for it — showing the filter section too
  // would just be a confusing, redundant "form" the user never needs to touch.
  // This is deliberately NOT keyed off `autoShow`: a plain report's own URL also gets
  // autoShow=true when its last-shown filter values are restored from history (see
  // the URL sync in handleShow below) — that case must still show its filter panel.
  const hideFilterPanel = !!backLink || !!isEmbeddedInModal;

  return (
    <div className="flex h-full min-h-0 flex-col gap-6">
      {(!!breadcrumb?.length || (!hideFilterPanel && isCollapsible)) && (
        <div className="flex shrink-0 items-center gap-2">
          {breadcrumb && breadcrumb.length > 0 && (
            <nav aria-label="Breadcrumb" className="min-w-0 truncate text-xs text-foreground/50">
              {breadcrumb.map((label, i) => (
                <span key={i}>
                  {i > 0 && <span className="mx-1.5">›</span>}
                  <span className={i === breadcrumb.length - 1 ? "font-medium text-foreground/70" : undefined}>{label}</span>
                </span>
              ))}
            </nav>
          )}
          {!hideFilterPanel && isCollapsible && (
            <button
              type="button"
              onClick={() => setCollapsed((c) => !c)}
              className="ml-auto shrink-0 text-sm text-brand-navy hover:underline"
            >
              {collapsed ? t("showParameters") : t("hideParameters")}
            </button>
          )}
        </div>
      )}
      {backLink && (
        <button
          type="button"
          onClick={() => router.back()}
          className="flex shrink-0 items-center gap-1 self-start text-sm text-brand-navy hover:underline"
        >
          ← Back to {backLink.label}
        </button>
      )}
      {!hideFilterPanel && !collapsed && (
        <div className="shrink-0 rounded-lg border border-border bg-card p-4 shadow-sm">
          <h1 className="mb-3 text-lg font-semibold text-foreground">{reportTitle}</h1>

          <div className="flex flex-col gap-3">
            {sortedRows.map(([rowNo, rowItems]) => (
              <div key={rowNo} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {[...rowItems]
                  .sort((a, b) => a.positionNo - b.positionNo)
                  .map((item) => (
                    <DynamicFilterField
                      key={item.id}
                      item={item}
                      value={values[item.componentCode] ?? ""}
                      onChange={(v) => handleFieldChange(item, v)}
                      dynamicOptions={dynamicOptions[item.id]}
                      disabled={
                        !!item.dependsOnItemId &&
                        !values[items.find((i) => i.id === item.dependsOnItemId)?.componentCode ?? ""]
                      }
                    />
                  ))}
              </div>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={mode === "REPORT" ? handleShow : handleSave}
              disabled={loading}
              className="btn-brand rounded-md px-4 py-2 text-sm font-semibold hover:opacity-90 disabled:opacity-60"
            >
              {loading ? t("working") : mode === "REPORT" ? t("show") : editingRecordId ? t("update") : t("save")}
            </button>
            <button
              type="button"
              onClick={handleReset}
              className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground/80 hover:bg-surface"
            >
              {t("reset")}
            </button>
          </div>

          {error && <p className="mt-3 text-sm text-danger">{error}</p>}
        </div>
      )}

      {hideFilterPanel && error && <p className="shrink-0 text-sm text-danger">{error}</p>}

      {exceeded && (
        <div className="flex shrink-0 flex-wrap items-center gap-3 rounded-lg border border-warning-border bg-warning-surface p-4 text-sm text-warning">
          <span>{exceeded.message}</span>
          {allowedFormats.includes("CSV") && (
            <button
              type="button"
              onClick={handleExport}
              className="btn-brand rounded-md px-3 py-1.5 text-xs font-semibold hover:opacity-90"
            >
              Download CSV instead
            </button>
          )}
        </div>
      )}

      {result && (
        <ResultsTable
          title={mode === "FORM" ? "Your saved records" : reportTitle}
          filterSummary={mode === "REPORT" ? buildFilterSummary(items, values) : undefined}
          columns={result.columns}
          rows={result.rows}
          freezeColumns={result.freezeColumns}
          displayStyle={result.displayStyle}
          footerNote={result.footerNote}
          highlightRules={result.highlightRules}
          allowedFormats={mode === "REPORT" ? allowedFormats : []}
          onExport={(format) => {
            if (format === "CSV") handleExport();
          }}
          onDrillDown={handleDrillDown}
          rowActions={
            mode === "FORM"
              ? (row) => (
                  <div className="flex gap-2">
                    <button type="button" onClick={() => handleEdit(row)} className="text-brand-navy hover:underline">
                      {t("edit")}
                    </button>
                    <button type="button" onClick={() => handleDelete(row)} className="text-danger hover:underline">
                      {t("delete")}
                    </button>
                  </div>
                )
              : undefined
          }
        />
      )}

      {drillModal && (
        <DrillDownModal
          reportId={drillModal.reportId}
          initialValues={drillModal.values}
          sizeOverride={drillModal.size}
          onClose={() => setDrillModal(null)}
        />
      )}
    </div>
  );
}
