/**
 * Pure rules for Administration > HR Sync: what the counts on screen mean, and when a
 * "running" job is really dead. No Prisma, no `server-only`; tested in tests/hr-sync-job.test.ts.
 */

/** Per-date ingest outcome, as ingestSpineRange() reports it (counts only). */
export interface IngestRunCounts {
  reqDate: string;
  status: "SUCCEEDED" | "FAILED";
  error?: string;
  summary: { received: number; inserted: number; updated: number; rejected: number; warned: number } | null;
}

/** What the lifecycle did to Synapse logins (counts and uids only). */
export interface LifecycleCounts {
  created: number;
  createdUids: number[];
  deactivated: number;
  suspended: number;
  unsuspended: number;
  lastWorkingDateSet: number;
  reviewsRaised: number;
  /** Active employees with no login who could not be added, grouped by reason. */
  notAdded: Record<string, number>;
}

/**
 * The summary stored on hr_sync_job and shown on screen.
 *
 * HR side — what Spine sent:
 *   fetched   records received across every date fetched
 *   newInHr   employees seen for the first time
 *   changed   existing employees whose details changed
 *   resigned  employees whose HR status moved from employed to not employed in this sync
 * Synapse side — what happened to logins: see LifecycleCounts.
 */
export interface SyncSummary {
  datesFetched: string[];
  fetched: number;
  newInHr: number;
  changed: number;
  resigned: number;
  rejected: number;
  logins: LifecycleCounts;
}

export function summarizeSync(runs: IngestRunCounts[], resigned: number, logins: LifecycleCounts): SyncSummary {
  const ok = runs.filter((r) => r.status === "SUCCEEDED" && r.summary);
  const sum = (k: "received" | "inserted" | "updated" | "rejected") => ok.reduce((n, r) => n + (r.summary?.[k] ?? 0), 0);
  return {
    datesFetched: ok.map((r) => r.reqDate),
    fetched: sum("received"),
    newInHr: sum("inserted"),
    changed: sum("updated"),
    rejected: sum("rejected"),
    resigned,
    logins,
  };
}

/** Collapse "No mapping for C001 / Mumbai / Sales" etc. into one line for the screen. */
export function notAddedReasonKey(reason: string): string {
  if (reason.startsWith("No mapping for")) return "No branch/department → hierarchy mapping";
  if (reason.startsWith("Employee has no branch")) return "No branch in HR";
  if (/is not numeric/.test(reason)) return "Employee code is not numeric";
  if (/already in use/.test(reason)) return "Username already in use";
  if (/same email/.test(reason)) return "An existing account has the same email — link it instead";
  return reason;
}

/**
 * A job that has said RUNNING for this long is dead (the server restarted mid-run — `after()`
 * work does not survive a restart). It is marked FAILED so the button works again; nothing it
 * did is lost, because every step it takes is idempotent and the next run carries on.
 */
export const STALE_JOB_MINUTES = 30;

export function isStale(startedAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - startedAt.getTime() > STALE_JOB_MINUTES * 60_000;
}
