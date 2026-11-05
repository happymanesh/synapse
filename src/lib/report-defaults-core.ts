/**
 * Dynamic defaults for report filters.
 *
 * `FilterDefinitionItem.defaultValue` is a stored string, which is fine for a fixed value
 * but cannot express "the last seven days" — a literal date pair would be correct on the day
 * it was seeded and wrong every day after. These tokens are resolved when the filter form is
 * built instead, so the window rolls with the calendar.
 *
 * Pure and free of `server-only`, so the rules are unit tested directly
 * (tests/report-defaults-core.test.ts) rather than only through a rendered form.
 */

/** Quick-range buttons offered beside every DATE_RANGE filter. */
export const QUICK_RANGE_DAYS = [7, 15, 30] as const;

/** `yyyy-mm-dd` in the server's own zone, which is what <input type="date"> expects.
 *
 *  Built from local parts rather than `toISOString().slice(0, 10)`: that returns the UTC
 *  date, which in IST is still yesterday until 05:30, so "today" would be off by a day
 *  every morning. */
export function toDateInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The DATE_RANGE wire format: `from,to`. */
export function lastNDaysRange(days: number, now: Date): string {
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days);
  return `${toDateInput(from)},${toDateInput(to)}`;
}

const LAST_N_DAYS = /^LAST_(\d+)_DAYS$/;

/**
 * Turn a stored default into the value a filter field should start with.
 *
 * Anything that is not a recognised token is returned unchanged, so existing literal
 * defaults keep working and an unknown token shows up as itself rather than silently
 * becoming empty — a default that quietly disappears is much harder to notice than one
 * that appears wrong.
 */
export function resolveFilterDefault(defaultValue: string | null | undefined, now: Date): string {
  if (!defaultValue) return "";
  const token = defaultValue.trim().toUpperCase();

  if (token === "TODAY") return toDateInput(now);
  if (token === "YESTERDAY") {
    return toDateInput(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  }

  const match = LAST_N_DAYS.exec(token);
  if (match) {
    const days = Number(match[1]);
    // A zero or absurd window is a configuration mistake; fall through and show the token
    // rather than silently filtering to nothing.
    if (days > 0 && days <= 3650) return lastNDaysRange(days, now);
  }

  return defaultValue;
}
