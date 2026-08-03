"use client";

import { useState } from "react";
import AdminCrudTable, { type ColumnConfig, type FieldConfig, type Row } from "@/components/admin/AdminCrudTable";
import { useLanguage } from "@/lib/i18n";

export default function FilterItemsModal({
  filterId,
  currentUsername,
  componentOptions,
}: {
  filterId: string;
  currentUsername: string;
  componentOptions: { value: string; label: string }[];
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<Row[] | null>(null);

  async function openModal() {
    setOpen(true);
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/filters/${filterId}/items`);
      const data = await res.json();
      setItems(res.ok ? data : []);
    } finally {
      setLoading(false);
    }
  }

  const dependsOnOptions = (items ?? []).map((i) => ({
    value: String(i.id),
    label: `${i.componentCode} (row ${i.rowNo}, pos ${i.positionNo})`,
  }));

  const fields: FieldConfig[] = [
    { name: "componentCode", label: "Component", type: "select", required: true, options: componentOptions },
    { name: "rowNo", label: "Row #", type: "number", required: true, defaultValue: 1 },
    { name: "positionNo", label: "Position #", type: "number", required: true, defaultValue: 1 },
    { name: "isMandatory", label: "Mandatory", type: "checkbox", defaultValue: false },
    { name: "labelOverride", label: "Label override", type: "text" },
    { name: "defaultValue", label: "Default value", type: "text" },
    { name: "mappedColumn", label: "Mapped column (FORM mode)", type: "text" },
    { name: "dependsOnItemId", label: "Cascades from (depends on)", type: "select", options: dependsOnOptions },
    { name: "isActive", label: "Active", type: "checkbox", defaultValue: true },
  ];

  const columns: ColumnConfig[] = [
    { key: "componentCode", label: "Component" },
    { key: "rowNo", label: "Row" },
    { key: "positionNo", label: "Pos" },
    { key: "isMandatory", label: "Mandatory" },
    { key: "mappedColumn", label: "Mapped column" },
    { key: "isActive", label: "Active" },
  ];

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        title="Manage items"
        aria-label="Manage items"
        className="rounded-md p-1.5 text-base leading-none text-brand-navy hover:bg-surface"
      >
        📑
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4">
          <div className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-lg bg-card p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-foreground">Filter items — {filterId}</h3>
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
                apiBasePath={`/api/admin/filters/${filterId}/items`}
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
