/**
 * Suspense boundary for the whole authenticated area.
 *
 * Without this, App Router has nothing to stream into: it blocks on the incoming page's
 * server render and keeps the *previous* page on screen, frozen, until it completes — then
 * swaps the lot at once, which reads as a full-page refresh. With the boundary, the shell
 * (top bar, sidebar, app switcher) stays mounted and interactive and only this slot swaps.
 *
 * It also unlocks prefetch: Next won't prefetch a dynamic route that has no loading
 * boundary, so hovering a menu item now warms the navigation instead of doing nothing.
 */
export default function Loading() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>

      {/* Breadcrumb line */}
      <div className="h-3 w-56 animate-pulse rounded bg-foreground/10" />

      {/* Filter/parameters card */}
      <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <div className="mb-4 h-4 w-40 animate-pulse rounded bg-foreground/10" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="space-y-2">
              <div className="h-2.5 w-20 animate-pulse rounded bg-foreground/10" />
              <div className="h-9 w-full animate-pulse rounded-md bg-foreground/5" />
            </div>
          ))}
        </div>
        <div className="mt-4 flex gap-2">
          <div className="h-9 w-24 animate-pulse rounded-md bg-foreground/10" />
          <div className="h-9 w-20 animate-pulse rounded-md bg-foreground/5" />
        </div>
      </div>

      {/* Results table */}
      <div className="overflow-hidden rounded-lg border border-border">
        <div className="h-10 w-full animate-pulse bg-surface" />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex gap-4 border-t border-border px-3 py-2.5">
            {[0, 1, 2, 3, 4].map((c) => (
              <div key={c} className="h-3 flex-1 animate-pulse rounded bg-foreground/5" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
