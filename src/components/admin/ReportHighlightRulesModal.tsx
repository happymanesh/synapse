"use client";

import { useState } from "react";
import AdminCrudTable, { type ColumnConfig, type FieldConfig, type Row } from "@/components/admin/AdminCrudTable";
import { useLanguage } from "@/lib/i18n";

const fields: FieldConfig[] = [
  { name: "columnKey", label: "Column key", type: "text", required: true },
  {
    name: "operator",
    label: "Operator",
    type: "select",
    required: true,
    options: [
      { value: "EQ", label: "Equals" },
      { value: "NEQ", label: "Not equals" },
      { value: "GT", label: "Greater than" },
      { value: "LT", label: "Less than" },
      { value: "GTE", label: "Greater or equal" },
      { value: "LTE", label: "Less or equal" },
      { value: "CONTAINS", label: "Contains" },
    ],
  },
  { name: "compareValue", label: "Compare value", type: "text", required: true },
  { name: "highlightColor", label: "Highlight color (CSS, e.g. #fee2e2)", type: "text", required: true },
  { name: "priority", label: "Priority (higher wins on conflicts)", type: "number", defaultValue: 0 },
];

const columns: ColumnConfig[] = [
  { key: "columnKey", label: "Column" },
  { key: "operator", label: "Operator" },
  { key: "compareValue", label: "Value" },
  { key: "highlightColor", label: "Color" },
  { key: "priority", label: "Priority" },
];

export default function ReportHighlightRulesModal({ reportId, currentUsername }: { reportId: string; currentUsername: string }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<Row[] | null>(null);

  async function openModal() {
    setOpen(true);
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/reports/${reportId}/highlight-rules`);
      const data = await res.json();
      setItems(res.ok ? data : []);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        title="Manage highlight rules"
        aria-label="Manage highlight rules"
        className="rounded-md p-1.5 text-base leading-none text-brand-navy hover:bg-surface"
      >
        🎨
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4">
          <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-card p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-foreground">Row highlight rules — {reportId}</h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground/70 hover:bg-surface hover:text-foreground"
              >
                Close
              </button>
            </div>
            {loading || !items ? (
              <p className="text-sm text-foreground/60">{t("loading")}</p>
            ) : (
              <AdminCrudTable
                apiBasePath={`/api/admin/reports/${reportId}/highlight-rules`}
                idField="id"
                columns={columns}
                fields={fields}
                initialData={items}
                currentUsername={currentUsername}
              />
            )}
          </div>
        </div>
      )}
    </>
  );
}
