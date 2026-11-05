"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * The filter row that sits under a ticket table's column headers.
 *
 * A client component inside an otherwise server-rendered table: only the inputs need to be
 * interactive, so the table itself — and every formatting helper it uses — stays on the
 * server. Column specs are plain data, which is what lets this nest inside a Server
 * Component at all.
 *
 * Filter state lives in the URL, not in this component. That is what makes a filtered view
 * bookmarkable and shareable, survives a refresh, and lets the Triage Queue's status boxes
 * be ordinary links rather than a second, parallel filtering mechanism.
 */

export type TicketColumnFilter =
  | { kind: "text"; param: string; placeholder?: string }
  | {
      kind: "select";
      param: string;
      options: { value: string; label: string }[];
      /**
       * What is actually being filtered on, when the page applies a default the URL does not
       * carry. Without it the control would read "Any status" while the list underneath was
       * filtered to open tickets — a filter bar that misreports the filter is worse than none.
       */
      value?: string;
    }
  | { kind: "none" };

export interface TicketColumnSpec {
  header: string;
  filter: TicketColumnFilter;
  align?: "left" | "center";
}

/** Typing shouldn't navigate on every keystroke — that would be a request per letter. */
const TYPING_SETTLE_MS = 350;

export default function TicketFilterRow({ columns }: { columns: TicketColumnSpec[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Text inputs are held locally while typing, then pushed to the URL once typing settles.
  // Without this the caret would jump on every re-render as the server round-trips.
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  // A draft is dropped when the field loses focus, which hands the input back to the URL.
  // That matters because the URL also changes from elsewhere — the Clear button, a status
  // box, the pager, the back button — and a stale draft would leave a filter box showing a
  // word that is no longer being filtered on. Doing it on blur rather than in an effect
  // keeps the caret where it is while someone is still typing.
  function forgetDraft(param: string) {
    setDrafts((d) => {
      if (!(param in d)) return d;
      const next = { ...d };
      delete next[param];
      return next;
    });
  }

  function pushParam(param: string, value: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set(param, value);
    else next.delete(param);
    // Any change to a filter invalidates the page number: narrowing a list while on page 4
    // would otherwise land on an empty page.
    next.delete("page");
    router.push(`${pathname}?${next.toString()}`);
  }

  useEffect(() => {
    const pending = Object.entries(drafts);
    if (pending.length === 0) return;
    const timer = setTimeout(() => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [param, value] of pending) {
        if (value.trim()) next.set(param, value.trim());
        else next.delete(param);
      }
      next.delete("page");
      router.push(`${pathname}?${next.toString()}`);
    }, TYPING_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [drafts, pathname, router, searchParams]);

  const inputClass =
    "w-full rounded border border-border bg-card px-2 py-1 text-xs font-normal text-foreground outline-none placeholder:text-foreground/35 focus:border-brand-navy focus:ring-1 focus:ring-brand-navy";

  return (
    <tr className="border-b border-border bg-card">
      {columns.map((col, i) => (
        <th key={i} className="px-2 py-2 align-top">
          {col.filter.kind === "text" && (
            <input
              type="search"
              aria-label={`Filter by ${col.header}`}
              placeholder={col.filter.placeholder ?? "Filter…"}
              value={drafts[col.filter.param] ?? searchParams.get(col.filter.param) ?? ""}
              onChange={(e) => {
                const param = col.filter.kind === "text" ? col.filter.param : "";
                setDrafts((d) => ({ ...d, [param]: e.target.value }));
              }}
              onBlur={() => forgetDraft(col.filter.kind === "text" ? col.filter.param : "")}
              className={inputClass}
            />
          )}
          {col.filter.kind === "select" && (
            <select
              aria-label={`Filter by ${col.header}`}
              value={col.filter.value ?? searchParams.get(col.filter.param) ?? ""}
              onChange={(e) => pushParam((col.filter as { param: string }).param, e.target.value)}
              className={inputClass}
            >
              {col.filter.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          )}
        </th>
      ))}
    </tr>
  );
}
