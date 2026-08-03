"use client";

import { useState } from "react";
import AdminCrudTable, { type ColumnConfig, type FieldConfig, type Row } from "@/components/admin/AdminCrudTable";
import { useLanguage } from "@/lib/i18n";

const columns: ColumnConfig[] = [
  { key: "columnKey", label: "Key" },
  { key: "displayLabel", label: "Label" },
  { key: "displayOrder", label: "Order" },
  { key: "dataType", label: "Type" },
  { key: "decimalPlaces", label: "Decimals" },
  { key: "isHighlighted", label: "Highlighted" },
  { key: "isIdentifier", label: "Identifier" },
  { key: "showTotal", label: "Total" },
  { key: "drillDownReportId", label: "Drills into" },
];

export default function ReportColumnsModal({
  reportId,
  currentUsername,
  reportOptions,
}: {
  reportId: string;
  currentUsername: string;
  reportOptions: { value: string; label: string }[];
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<Row[] | null>(null);

  const fields: FieldConfig[] = [
    { name: "columnKey", label: "Column key (must match query result)", type: "text", required: true },
    { name: "displayLabel", label: "Display label", type: "text", required: true },
    { name: "displayOrder", label: "Display order", type: "number", required: true, defaultValue: 0 },
    {
      name: "dataType",
      label: "Data type (drives formatting, alignment, sorting)",
      type: "select",
      required: true,
      defaultValue: "TEXT",
      options: [
        { value: "TEXT", label: "Text (left-aligned)" },
        { value: "NUMBER", label: "Number (right-aligned)" },
        { value: "DATE", label: "Date — dd-Mmm-yyyy (center-aligned)" },
        { value: "DATETIME", label: "Date + time — dd-Mmm-yyyy hh:mm (center-aligned)" },
      ],
    },
    { name: "decimalPlaces", label: "Decimal places (NUMBER only, e.g. 2 for an amount)", type: "number" },
    { name: "isHighlighted", label: "Highlighted column", type: "checkbox", defaultValue: false },
    { name: "isIdentifier", label: "Identifier column (row primary key)", type: "checkbox", defaultValue: false },
    { name: "showTotal", label: "Show column total in footer (NUMBER only)", type: "checkbox", defaultValue: false },
    {
      name: "drillDownReportId",
      label: "Drill-down: report to open when a cell is clicked (leave blank for none)",
      type: "select",
      options: reportOptions.filter((r) => r.value !== reportId),
    },
    {
      name: "drillDownTargetParam",
      label: "Drill-down: target filter param (component code), or a JSON discriminator map — see CLAUDE.md",
      type: "text",
      showWhen: { field: "drillDownReportId", notEmpty: true },
    },
    {
      name: "drillDownMode",
      label: "Drill-down display",
      type: "select",
      defaultValue: "PAGE",
      showWhen: { field: "drillDownReportId", notEmpty: true },
      options: [
        { value: "PAGE", label: "Normal (a full report page, with a back link)" },
        { value: "MODAL", label: "Popup (a small window, with a close button)" },
      ],
    },
    {
      name: "drillDownModalSize",
      label: "Drill-down popup size",
      type: "select",
      defaultValue: "AUTO",
      showWhen: { field: "drillDownMode", equals: "MODAL" },
      options: [
        { value: "AUTO", label: "Auto — sized to the data returned" },
        { value: "SMALL", label: "Small" },
        { value: "MEDIUM", label: "Medium" },
        { value: "LARGE", label: "Large" },
      ],
    },
  ];

  async function openModal() {
    setOpen(true);
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/reports/${reportId}/columns`);
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
        title="Manage columns"
        aria-label="Manage columns"
        className="rounded-md p-1.5 text-base leading-none text-brand-navy hover:bg-surface"
      >
        📋
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4">
          <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-card p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-foreground">Columns — {reportId}</h3>
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
                apiBasePath={`/api/admin/reports/${reportId}/columns`}
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
