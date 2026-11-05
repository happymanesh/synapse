"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";

/**
 * The Created date range above a ticket list, with optional quick ranges.
 *
 * The values shown are always the ones in effect — when the URL carries no dates, the page
 * computes a default and passes it in, so the boxes show the window actually being applied
 * rather than sitting empty while the list is silently filtered.
 */
export default function TicketDateRange({
  from,
  to,
  quickRanges = [],
  showClear = false,
}: {
  from: string;
  to: string;
  /** e.g. [7, 15, 30] — buttons that set the range to the last N days. */
  quickRanges?: number[];
  showClear?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function push(params: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(params)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    next.delete("page");
    router.push(`${pathname}?${next.toString()}`);
  }

  function lastDays(days: number) {
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - days);
    const pad = (n: number) => String(n).padStart(2, "0");
    const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    push({ from: fmt(start), to: fmt(today) });
  }

  const field =
    "rounded-md border border-border bg-card px-2 py-1.5 text-xs text-foreground outline-none focus:border-brand-navy focus:ring-1 focus:ring-brand-navy";
  const quick = "rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-surface";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="text-xs font-medium text-foreground/70" htmlFor="ticket-from">
        Created
      </label>
      <input
        id="ticket-from"
        type="date"
        value={from}
        max={to}
        onChange={(e) => push({ from: e.target.value })}
        className={field}
      />
      <span className="text-xs text-foreground/50">to</span>
      <input
        id="ticket-to"
        type="date"
        value={to}
        min={from}
        onChange={(e) => push({ to: e.target.value })}
        className={field}
      />

      {quickRanges.map((days) => (
        <button key={days} type="button" onClick={() => lastDays(days)} className={quick}>
          Last {days} days
        </button>
      ))}

      {showClear && (
        <button
          type="button"
          onClick={() => router.push(pathname)}
          className="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground/70 hover:bg-surface hover:text-foreground"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
