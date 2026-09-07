/**
 * Small presentational helpers shared by the Support screens. No "use client" — these are
 * pure rendering, so they work in Server Components and only cost client JS where the
 * importing component is already a client one.
 *
 * Uses only the theme tokens declared in globals.css: an invented colour name silently
 * renders nothing under Tailwind v4 (REBUILD Trap 8).
 */

const STATUS_STYLES: Record<string, string> = {
  OPEN: "bg-warning-surface text-foreground/80 border-warning-border",
  IN_PROGRESS: "bg-warning-surface text-foreground/80 border-warning-border",
  FORWARDED: "bg-surface text-foreground/70 border-border",
  AWAITING_CR_APPROVAL: "bg-surface text-foreground/70 border-border",
  RESOLVED: "bg-success/10 text-success border-success/30",
  CLOSED: "bg-surface text-foreground/60 border-border",
  MERGED: "bg-surface text-foreground/50 border-border",
};

export function StatusPill({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? "bg-surface text-foreground/70 border-border";
  return (
    <span className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${style}`}>
      {status.replace(/_/g, " ").toLowerCase()}
    </span>
  );
}

/** Compact elapsed time — "3d 4h", "5h", "12m". Long enough to judge urgency at a glance
 * without turning the queue into a wall of timestamps. */
export function formatElapsed(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours ? `${days}d ${restHours}h` : `${days}d`;
}

/**
 * Age since the turnaround clock started, flagged red once it has passed the flat §4.5
 * response target with nobody having replied. The clock — not raisedAt — is deliberate: a
 * merged thread should show the full elapsed time of the earliest report.
 *
 * `now` is passed in rather than read here: calling Date.now() during render is impure, and
 * every row in one render should measure against the same instant or the list is internally
 * inconsistent.
 */
export function AgeCell({ since, now, breached }: { since: Date; now: Date; breached: boolean }) {
  return (
    <span className={breached ? "font-semibold text-danger" : "text-foreground/80"}>
      {formatElapsed(now.getTime() - since.getTime())}
      {breached && <span className="ml-1 text-xs">overdue</span>}
    </span>
  );
}
