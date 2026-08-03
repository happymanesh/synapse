"use client";

import { useState } from "react";
import { useLanguage } from "@/lib/i18n";

export interface MappingColumn {
  key: string;
  label: string;
}

interface ChecklistItem {
  code: string;
  cells: Record<string, string>;
}

export default function MappingChecklistModal({
  triggerLabel,
  triggerIcon,
  title,
  fetchUrl,
  saveUrl,
  columns,
}: {
  triggerLabel: string;
  /** Renders the trigger as an icon-only button (title/aria-label = triggerLabel) instead of a text link. */
  triggerIcon?: string;
  title: string;
  fetchUrl: string;
  saveUrl: string;
  columns: MappingColumn[];
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  async function openModal() {
    setOpen(true);
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(fetchUrl);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Unable to load.");
        return;
      }
      setItems(data.items);
      setSelected(new Set(data.selected));
    } catch {
      setError("Unable to load.");
    } finally {
      setLoading(false);
    }
  }

  function toggle(code: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(saveUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codes: Array.from(selected) }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Unable to save.");
        return;
      }
      setOpen(false);
    } catch {
      setError("Unable to save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {triggerIcon ? (
        <button
          type="button"
          onClick={openModal}
          title={triggerLabel}
          aria-label={triggerLabel}
          className="rounded-md p-1.5 text-base leading-none text-brand-navy hover:bg-surface"
        >
          {triggerIcon}
        </button>
      ) : (
        <button type="button" onClick={openModal} className="text-brand-navy hover:underline">
          {triggerLabel}
        </button>
      )}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4">
          <div className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-card p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-foreground">{title}</h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground/70 hover:bg-surface hover:text-foreground"
              >
                {t("close")}
              </button>
            </div>

            {loading ? (
              <p className="text-sm text-foreground/60">{t("loading")}</p>
            ) : (
              <>
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-surface text-xs text-foreground/60 uppercase">
                      <tr>
                        <th className="px-3 py-2 font-medium">Assign</th>
                        {columns.map((c) => (
                          <th key={c.key} className="px-3 py-2 font-medium">
                            {c.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {items.length === 0 && (
                        <tr>
                          <td colSpan={columns.length + 1} className="px-3 py-6 text-center text-foreground/50">
                            {t("nothingToAssign")}
                          </td>
                        </tr>
                      )}
                      {items.map((item) => (
                        <tr key={item.code} className="border-t border-border">
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              checked={selected.has(item.code)}
                              onChange={() => toggle(item.code)}
                              className="h-4 w-4"
                            />
                          </td>
                          {columns.map((c) => (
                            <td key={c.key} className="px-3 py-2">
                              {item.cells[c.key] ?? "—"}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {error && <p className="mt-3 text-sm text-danger">{error}</p>}

                <div className="mt-4 flex gap-2">
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving}
                    className="btn-brand rounded-md px-4 py-2 text-sm font-semibold hover:opacity-90 disabled:opacity-60"
                  >
                    {saving ? t("saving") : t("save")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground/80 hover:bg-surface"
                  >
                    Close
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
