"use client";

import { useCallback, useEffect, useState } from "react";

export interface AuditRow {
  id: number;
  when: string;
  actorUsername: string;
  action: string;
  model: string;
  recordId: string;
  summary: string;
  ipAddress: string;
}

const ACTION_STYLE: Record<string, string> = {
  CREATE: "bg-success-surface text-success border-success-border",
  UPDATE: "bg-info-surface text-info border-info-border",
  DELETE: "bg-danger-surface text-danger border-danger-border",
};

/**
 * Read-only by construction. This is not AdminCrudTable with the buttons hidden — there is
 * no add, edit or delete path here at all, and the API route behind it exposes only GET.
 * An audit trail an administrator can edit is not evidence of anything.
 */
export default function AuditTable({
  initialRows,
  initialTotal,
  pageSize = 20,
}: {
  initialRows: AuditRow[];
  initialTotal: number;
  pageSize?: number;
}) {
  const [rows, setRows] = useState(initialRows);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (nextPage: number, nextSearch: string) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ page: String(nextPage), pageSize: String(pageSize) });
        if (nextSearch) params.set("search", nextSearch);
        const res = await fetch(`/api/admin/audit?${params}`);
        if (!res.ok) return;
        const data = await res.json();
        setRows(data.rows);
        setTotal(data.total);
      } finally {
        setLoading(false);
      }
    },
    [pageSize]
  );

  // Debounced, so typing a username does not fire a query per keystroke against a table
  // that only grows.
  useEffect(() => {
    const id = setTimeout(() => {
      setPage(1);
      load(1, search);
    }, 300);
    return () => clearTimeout(id);
  }, [search, load]);

  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search user, model, record or action…"
          className="w-72 rounded-md border border-border bg-card px-3 py-1.5 text-sm outline-none focus:border-brand-navy focus:ring-1 focus:ring-brand-navy"
        />
        {loading && <span className="text-xs text-foreground/50">Loading…</span>}
      </div>

      <div className="max-h-[70vh] overflow-auto rounded-lg border border-border">
        <table className="w-max min-w-full text-left text-sm">
          <thead className="sticky top-0 z-10 bg-surface text-xs text-foreground/60 uppercase shadow-[inset_0_-1px_0_var(--border-color)]">
            <tr>
              {["When", "User", "Action", "Model", "Record", "Change", "IP"].map((h) => (
                <th key={h} className="whitespace-nowrap px-3 py-2.5 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-foreground/50">
                  No changes recorded yet.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-border transition-colors hover:bg-surface/60">
                <td className="whitespace-nowrap px-3 py-2 tabular-nums text-foreground/70">{r.when}</td>
                <td className="whitespace-nowrap px-3 py-2 font-medium">{r.actorUsername}</td>
                <td className="whitespace-nowrap px-3 py-2">
                  <span
                    className={`inline-block rounded border px-1.5 py-0.5 text-xs font-medium ${
                      ACTION_STYLE[r.action] ?? "border-border bg-surface text-foreground/70"
                    }`}
                  >
                    {r.action}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-2">{r.model}</td>
                <td className="whitespace-nowrap px-3 py-2 text-foreground/70">{r.recordId}</td>
                {/* The one column allowed to wrap: it carries the actual content. */}
                <td className="max-w-xl px-3 py-2 text-foreground/70">{r.summary}</td>
                <td className="whitespace-nowrap px-3 py-2 tabular-nums text-foreground/50">{r.ipAddress}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-foreground/60">
        <span className="tabular-nums">
          {from}–{to} / {total}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={page <= 1 || loading}
            onClick={() => {
              const p = page - 1;
              setPage(p);
              load(p, search);
            }}
            className="rounded-md border border-border px-3 py-1 disabled:opacity-40"
          >
            Previous
          </button>
          <button
            type="button"
            disabled={to >= total || loading}
            onClick={() => {
              const p = page + 1;
              setPage(p);
              load(p, search);
            }}
            className="rounded-md border border-border px-3 py-1 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
