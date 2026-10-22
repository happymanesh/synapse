/**
 * Shaping for the dashboard's login-activity series.
 *
 * Pure and Prisma-free so it is unit tested (tests/dashboard-core.test.ts); the query
 * lives in the dashboard page. The shaping is the part with the bugs in it — days with no
 * activity have no rows at all, and a chart that simply plots what the database returned
 * would silently omit them and draw a straight line across a quiet weekend.
 */

export interface LoginDayPoint {
  /** Short weekday label for the axis. */
  day: string;
  /** ISO date, so a tooltip can show the real date rather than an ambiguous weekday. */
  date: string;
  success: number;
  failure: number;
}

export interface LoginAttemptRow {
  loginTime: Date;
  status: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Local-time YYYY-MM-DD. Not toISOString(), which shifts to UTC and misfiles late-evening logins. */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Midnight local time, the boundary every daily figure on this page counts from. */
export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * One point per day for the last `days` days, oldest first — including days with no
 * attempts at all, which is the whole reason this exists rather than a GROUP BY.
 */
export function buildLoginSeries(rows: LoginAttemptRow[], now: Date, days = 7): LoginDayPoint[] {
  const buckets = new Map<string, { success: number; failure: number }>();
  const today = startOfDay(now);

  for (let i = days - 1; i >= 0; i--) {
    buckets.set(dayKey(new Date(today.getTime() - i * DAY_MS)), { success: 0, failure: 0 });
  }

  for (const r of rows) {
    const bucket = buckets.get(dayKey(r.loginTime));
    // Anything outside the window is ignored rather than clamped into the first day,
    // which would otherwise show a fake spike at the left edge.
    if (!bucket) continue;
    if (r.status === "SUCCESS") bucket.success++;
    else bucket.failure++;
  }

  const labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return [...buckets.entries()].map(([date, counts]) => ({
    date,
    day: labels[new Date(`${date}T00:00:00`).getDay()],
    ...counts,
  }));
}

/** Whole percent change from `previous` to `current`, or null when there is no baseline to compare against. */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}
