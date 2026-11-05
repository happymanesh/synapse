import Link from "next/link";
import type { PageWindow } from "@/lib/ticket-list-core";

/**
 * Page links under a ticket table.
 *
 * A Server Component built from `<Link>`s rather than buttons: paging is navigation, so it
 * should be linkable, open in a new tab, and work with the back button like everything else
 * in these lists.
 *
 * Shows a window of page numbers around the current page rather than all of them — a desk
 * with 4,000 tickets would otherwise get 160 links.
 */
const WINDOW = 2;

export default function TicketPager({
  window: w,
  searchParams,
  basePath,
}: {
  window: PageWindow;
  searchParams: Record<string, string | string[] | undefined>;
  basePath: string;
}) {
  if (w.total === 0) return null;

  const href = (page: number) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      if (key === "page") continue;
      const v = Array.isArray(value) ? value[0] : value;
      if (v !== undefined && v !== "") next.set(key, v);
    }
    if (page > 1) next.set("page", String(page));
    const qs = next.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  const first = Math.max(1, w.page - WINDOW);
  const last = Math.min(w.pages, w.page + WINDOW);
  const pages = Array.from({ length: last - first + 1 }, (_, i) => first + i);

  const link = "rounded border border-border px-2.5 py-1 text-xs hover:bg-surface";
  const muted = "rounded border border-border px-2.5 py-1 text-xs text-foreground/30";

  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
      <p className="text-xs text-foreground/60">
        Showing {w.firstRow}–{w.lastRow} of {w.total}
      </p>

      {w.pages > 1 && (
        <nav className="flex items-center gap-1" aria-label="Pagination">
          {w.page > 1 ? (
            <Link href={href(w.page - 1)} className={link} rel="prev">
              Previous
            </Link>
          ) : (
            <span className={muted}>Previous</span>
          )}

          {first > 1 && (
            <>
              <Link href={href(1)} className={link}>
                1
              </Link>
              {first > 2 && <span className="px-1 text-xs text-foreground/40">…</span>}
            </>
          )}

          {pages.map((p) => (
            <Link
              key={p}
              href={href(p)}
              aria-current={p === w.page ? "page" : undefined}
              className={
                p === w.page
                  ? "rounded border border-brand-navy bg-brand-navy px-2.5 py-1 text-xs font-semibold text-white"
                  : link
              }
            >
              {p}
            </Link>
          ))}

          {last < w.pages && (
            <>
              {last < w.pages - 1 && <span className="px-1 text-xs text-foreground/40">…</span>}
              <Link href={href(w.pages)} className={link}>
                {w.pages}
              </Link>
            </>
          )}

          {w.page < w.pages ? (
            <Link href={href(w.page + 1)} className={link} rel="next">
              Next
            </Link>
          ) : (
            <span className={muted}>Next</span>
          )}
        </nav>
      )}
    </div>
  );
}
