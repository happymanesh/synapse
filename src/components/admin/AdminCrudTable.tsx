"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { buildDownloadFilename } from "@/lib/download";
import { useLanguage } from "@/lib/i18n";

export type FieldType = "text" | "number" | "password" | "select" | "checkbox" | "textarea" | "datetime-local";

export interface FieldOption {
  value: string;
  label: string;
}

/**
 * Condition for showing a field, expressed as data rather than a predicate function.
 * Admin pages are Server Components, and a function prop would throw "Functions cannot
 * be passed directly to Client Components" — this crosses the RSC boundary fine.
 */
export interface ShowWhen {
  /** Another field's name, whose current value decides this field's visibility. */
  field: string;
  /** Show when that field equals this value (or any one of these values). */
  equals?: string | string[];
  /** Show when that field simply has any value at all. */
  notEmpty?: true;
}

export interface FieldConfig {
  name: string;
  label: string;
  type: FieldType;
  options?: FieldOption[];
  required?: boolean;
  hideOnEdit?: boolean;
  disabledOnEdit?: boolean;
  defaultValue?: string | number | boolean;
  /** Hides the field unless the condition holds. Hidden fields are cleared on submit. */
  showWhen?: ShowWhen;
  /**
   * Renders this field beside the preceding one instead of on its own row. Grouping runs
   * after `showWhen` filtering, so if the field it would pair with is hidden, this one
   * simply starts its own row rather than leaving a gap.
   */
  inlineWithPrevious?: boolean;
}

function isFieldVisible(field: FieldConfig, values: Record<string, string | number | boolean>): boolean {
  const cond = field.showWhen;
  if (!cond) return true;
  const current = String(values[cond.field] ?? "");
  if (cond.notEmpty) return current !== "";
  if (cond.equals === undefined) return true;
  const allowed = Array.isArray(cond.equals) ? cond.equals : [cond.equals];
  return allowed.includes(current);
}

export interface ColumnConfig {
  key: string;
  label: string;
  render?: (row: Record<string, unknown>) => React.ReactNode;
}

export type Row = Record<string, string | number | boolean | null | undefined | Date | string[]>;

export interface PagingConfig {
  pageSize?: number;
}

export default function AdminCrudTable({
  apiBasePath,
  idField,
  columns,
  fields,
  initialData,
  initialTotal,
  paging,
  RowActions,
  currentUsername,
  compactActions,
  companyFilterOptions,
  companyFilterKey,
}: {
  apiBasePath: string;
  idField: string;
  columns: ColumnConfig[];
  fields: FieldConfig[];
  currentUsername: string;
  initialData: Row[];
  initialTotal?: number;
  paging?: PagingConfig;
  RowActions?: React.ComponentType<{ row: Row }>;
  /** Renders Edit/Delete as small icon buttons instead of text — for tables with several row actions where space is tight. */
  compactActions?: boolean;
  /** Shows a "Filter by company" dropdown. With `paging`, filtering happens server-side (via a `company` query param); without it, rows are filtered client-side by `companyFilterKey`. */
  companyFilterOptions?: FieldOption[];
  /** Row field the company filter matches against — defaults to "companyCode". */
  companyFilterKey?: string;
}) {
  const router = useRouter();
  const { t } = useLanguage();
  const pageSize = paging?.pageSize ?? 20;
  const [rows, setRows] = useState<Row[]>(initialData);
  const [mode, setMode] = useState<"add" | "edit" | null>(null);
  const [editingRow, setEditingRow] = useState<Row | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string | number | boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [page, setPage] = useState(1);
  const [companyFilter, setCompanyFilter] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [total, setTotal] = useState(initialTotal ?? initialData.length);
  const [loading, setLoading] = useState(false);
  const didMount = useRef(false);

  async function fetchPage() {
    if (!paging) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (companyFilter) params.set("company", companyFilter);
      if (searchTerm.trim()) params.set("search", searchTerm.trim());
      const res = await fetch(`${apiBasePath}?${params.toString()}`);
      const data = await res.json();
      if (res.ok) {
        setRows(data.rows);
        setTotal(data.total);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!paging) return;
    if (!didMount.current) {
      didMount.current = true;
      return;
    }
    fetchPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, companyFilter, searchTerm]);

  // Non-paged tables filter the already-loaded rows client-side; paged tables (Users)
  // already get a server-filtered `rows` back from fetchPage above, so this is a no-op there.
  const visibleRows = paging
    ? rows
    : rows.filter((row) => {
        if (companyFilterOptions && companyFilter) {
          if (String(row[companyFilterKey ?? "companyCode"] ?? "") !== companyFilter) return false;
        }
        const term = searchTerm.trim().toLowerCase();
        if (!term) return true;
        const haystack = columns.map((c) => formatCellText(row[c.key])).join(" ").toLowerCase();
        return haystack.includes(term);
      });

  function openAdd() {
    const defaults: Record<string, string | number | boolean> = {};
    for (const f of fields) {
      if (f.hideOnEdit === undefined || true) {
        defaults[f.name] = f.defaultValue ?? (f.type === "checkbox" ? true : "");
      }
    }
    setFormValues(defaults);
    setEditingRow(null);
    setMode("add");
    setError(null);
    setFieldErrors({});
  }

  function openEdit(row: Row) {
    const values: Record<string, string | number | boolean> = {};
    for (const f of fields) {
      if (f.hideOnEdit) continue;
      const v = row[f.name];
      if (v === null || v === undefined) {
        values[f.name] = f.type === "checkbox" ? false : "";
      } else if (v instanceof Date) {
        values[f.name] = v.toISOString().slice(0, f.type === "datetime-local" ? 16 : 10);
      } else if (Array.isArray(v)) {
        values[f.name] = v.join(", ");
      } else {
        values[f.name] = v;
      }
    }
    setFormValues(values);
    setEditingRow(row);
    setMode("edit");
    setError(null);
    setFieldErrors({});
  }

  function closeModal() {
    setMode(null);
    setEditingRow(null);
    setError(null);
    setFieldErrors({});
  }

  function updateField(name: string, value: string | number | boolean) {
    setFormValues((v) => ({ ...v, [name]: value }));
    setFieldErrors((prev) => {
      if (!prev[name]) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setFieldErrors({});
    try {
      const url = mode === "add" ? apiBasePath : `${apiBasePath}/${encodeURIComponent(String(editingRow![idField]))}`;
      const method = mode === "add" ? "POST" : "PUT";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        // A field the user filled in and then hid (e.g. typed a Route Path, then switched
        // the menu type to EXTERNAL) is submitted as empty rather than omitted: omitting it
        // would leave the old value untouched on update, so the record would keep data the
        // form no longer shows and the admin has no way to see or clear.
        body: JSON.stringify(
          Object.fromEntries(
            Object.entries(formValues).map(([name, value]) => {
              const field = fields.find((f) => f.name === name);
              if (field && !isFieldVisible(field, formValues)) {
                return [name, field.type === "checkbox" ? false : ""];
              }
              return [name, value];
            })
          )
        ),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        setFieldErrors(data.fieldErrors ?? {});
        return;
      }
      if (paging) {
        await fetchPage();
      } else if (mode === "add") {
        setRows((prev) => [...prev, data]);
      } else {
        setRows((prev) => prev.map((r) => (r[idField] === editingRow![idField] ? data : r)));
      }
      closeModal();
      router.refresh();
    } catch {
      setError(t("somethingWentWrong"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(row: Row) {
    if (!confirm(t("confirmDelete"))) return;
    const res = await fetch(`${apiBasePath}/${encodeURIComponent(String(row[idField]))}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.error ?? "Unable to delete this record.");
      return;
    }
    if (paging) {
      await fetchPage();
    } else {
      setRows((prev) => prev.filter((r) => r[idField] !== row[idField]));
    }
    router.refresh();
  }

  function handleExport() {
    // Export every field of the underlying record, not just what's shown on screen —
    // the visible `columns` are a curated subset for readability, but exports should
    // be complete (minus anything genuinely sensitive, like password hashes). Rows
    // respect the current search/company filter, matching what's on screen.
    const keySet = new Set<string>();
    visibleRows.forEach((row) => Object.keys(row).forEach((k) => keySet.add(k)));
    SENSITIVE_EXPORT_KEYS.forEach((k) => keySet.delete(k));
    const keys = keySet.size > 0 ? Array.from(keySet) : columns.map((c) => c.key);

    const columnLabels = new Map(columns.map((c) => [c.key, c.label]));
    const header = keys.map((k) => columnLabels.get(k) ?? humanizeKey(k));
    const body = visibleRows.map((row) => keys.map((k) => formatCellText(row[k])));
    const csv = [header, ...body].map((line) => line.map(csvEscape).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = buildDownloadFilename(currentUsername, "csv");
    a.click();
    URL.revokeObjectURL(url);
  }

  // Group the fields the form will actually show into rows. Done after hideOnEdit and
  // showWhen filtering so an `inlineWithPrevious` field whose partner is hidden just
  // starts its own row instead of pairing with something unrelated.
  const fieldRows: FieldConfig[][] = [];
  for (const f of fields.filter((f) => !(mode === "edit" && f.hideOnEdit)).filter((f) => isFieldVisible(f, formValues))) {
    if (f.inlineWithPrevious && fieldRows.length > 0) fieldRows[fieldRows.length - 1].push(f);
    else fieldRows.push([f]);
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              if (paging) setPage(1);
            }}
            placeholder={t("searchRecords")}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-sm outline-none focus:border-brand-navy focus:ring-1 focus:ring-brand-navy"
          />
          {companyFilterOptions && (
            <select
              value={companyFilter}
              onChange={(e) => {
                setCompanyFilter(e.target.value);
                if (paging) setPage(1);
              }}
              className="rounded-md border border-border bg-card px-3 py-1.5 text-sm outline-none focus:border-brand-navy focus:ring-1 focus:ring-brand-navy"
            >
              <option value="">{t("allCompanies")}</option>
              {companyFilterOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleExport}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground/80 hover:bg-surface"
          >
            {t("export")}
          </button>
          <button
            type="button"
            onClick={openAdd}
            className="btn-brand rounded-md px-3 py-1.5 text-sm font-medium hover:opacity-90"
          >
            + {t("add")}
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface text-xs text-foreground/60 uppercase">
            <tr>
              {columns.map((c) => (
                <th key={c.key} className="px-3 py-2 font-medium">
                  {c.label}
                </th>
              ))}
              <th className="px-3 py-2 font-medium">{t("actions")}</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 && (
              <tr>
                <td colSpan={columns.length + 1} className="px-3 py-6 text-center text-foreground/50">
                  {t("noRecordsYet")}
                </td>
              </tr>
            )}
            {visibleRows.map((row) => (
              <tr key={String(row[idField])} className="border-t border-border">
                {columns.map((c) => (
                  <td key={c.key} className="px-3 py-2">
                    {c.render ? c.render(row) : formatCellText(row[c.key])}
                  </td>
                ))}
                <td className="px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {compactActions ? (
                      <>
                        <button
                          type="button"
                          onClick={() => openEdit(row)}
                          title={t("edit")}
                          aria-label={t("edit")}
                          className="rounded-md p-1.5 text-base leading-none text-brand-navy hover:bg-surface"
                        >
                          ✏️
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(row)}
                          title={t("delete")}
                          aria-label={t("delete")}
                          className="rounded-md p-1.5 text-base leading-none text-danger hover:bg-surface"
                        >
                          🗑️
                        </button>
                      </>
                    ) : (
                      <>
                        <button type="button" onClick={() => openEdit(row)} className="text-brand-navy hover:underline">
                          {t("edit")}
                        </button>
                        <button type="button" onClick={() => handleDelete(row)} className="text-danger hover:underline">
                          {t("delete")}
                        </button>
                      </>
                    )}
                    {RowActions && <RowActions row={row} />}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {paging && (
        <div className="mt-3 flex items-center justify-between text-sm text-foreground/60">
          <span>
            {loading
              ? t("loading")
              : total === 0
                ? t("noRecords")
                : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} / ${total}`}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded-md border border-border px-3 py-1 disabled:opacity-40"
            >
              {t("previous")}
            </button>
            <button
              type="button"
              disabled={page * pageSize >= total || loading}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-md border border-border px-3 py-1 disabled:opacity-40"
            >
              {t("next")}
            </button>
          </div>
        </div>
      )}

      {mode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4">
          <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-lg bg-card p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-foreground">{mode === "add" ? t("add") : t("edit")}</h3>
              <button
                type="button"
                onClick={closeModal}
                className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground/70 hover:bg-surface hover:text-foreground"
              >
                {t("close")}
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col gap-3">
              {fieldRows.map((row) => {
                const content = row.map((f) => {
                  const fieldError = fieldErrors[f.name];
                  const borderClass = fieldError
                    ? "border-danger focus:border-danger focus:ring-danger"
                    : "border-border focus:border-brand-navy focus:ring-brand-navy";
                  return (
                    <div key={f.name} className={row.length > 1 ? "min-w-32 flex-1" : undefined}>
                      <label className={`mb-1 block text-xs font-medium ${fieldError ? "text-danger" : "text-foreground/80"}`}>
                        {f.label}
                      </label>
                      {f.type === "select" ? (
                        <select
                          required={f.required}
                          disabled={mode === "edit" && f.disabledOnEdit}
                          value={String(formValues[f.name] ?? "")}
                          onChange={(e) => updateField(f.name, e.target.value)}
                          className={`w-full rounded-md border bg-card px-3 py-2 text-sm outline-none focus:ring-1 ${borderClass}`}
                        >
                          <option value="">—</option>
                          {f.options?.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      ) : f.type === "checkbox" ? (
                        <input
                          type="checkbox"
                          checked={!!formValues[f.name]}
                          onChange={(e) => updateField(f.name, e.target.checked)}
                          className="h-4 w-4"
                        />
                      ) : f.type === "textarea" ? (
                        <textarea
                          required={f.required}
                          disabled={mode === "edit" && f.disabledOnEdit}
                          value={String(formValues[f.name] ?? "")}
                          onChange={(e) => updateField(f.name, e.target.value)}
                          className={`w-full rounded-md border bg-card px-3 py-2 text-sm outline-none focus:ring-1 ${borderClass}`}
                        />
                      ) : (
                        <input
                          type={f.type}
                          required={f.required}
                          disabled={mode === "edit" && f.disabledOnEdit}
                          value={String(formValues[f.name] ?? "")}
                          onChange={(e) => updateField(f.name, f.type === "number" ? e.target.valueAsNumber : e.target.value)}
                          className={`w-full rounded-md border bg-card px-3 py-2 text-sm outline-none focus:ring-1 disabled:opacity-50 ${borderClass}`}
                        />
                      )}
                      {fieldError && <p className="mt-1 text-xs text-danger">{fieldError}</p>}
                    </div>
                  );
                });
                const key = row.map((f) => f.name).join("|");
                return row.length > 1 ? (
                  <div key={key} className="flex flex-wrap items-start gap-4">
                    {content}
                  </div>
                ) : (
                  <div key={key}>{content}</div>
                );
              })}

              {error && <p className="text-sm text-danger">{error}</p>}

              <div className="mt-2 flex gap-2">
                <button
                  type="submit"
                  disabled={submitting}
                  className="btn-brand rounded-md px-4 py-2 text-sm font-semibold hover:opacity-90 disabled:opacity-60"
                >
                  {submitting ? t("saving") : t("save")}
                </button>
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground/80 hover:bg-surface"
                >
                  {t("close")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function formatCellText(value: unknown): string {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value instanceof Date) return value.toLocaleDateString();
  if (Array.isArray(value)) return value.length > 0 ? value.join(", ") : "—";
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// Fields that must never end up in an exported file, even though "export everything"
// is the default — credentials stay out no matter what.
const SENSITIVE_EXPORT_KEYS = new Set(["passwordHash", "password"]);

function humanizeKey(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
