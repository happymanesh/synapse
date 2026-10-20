/**
 * Calendar-date helpers shared by HR ingestion and lifecycle. Pure; no Prisma.
 *
 * HR dates are days, not instants, and SIHL's day is the Indian one — so every "today" here
 * is the IST calendar date regardless of the server's own zone.
 */

/** A calendar date as "YYYY-MM-DD". Compares correctly as a string. */
export type IsoDate = string;

export function todayInIndia(now: Date = new Date()): IsoDate {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function addDays(d: IsoDate, days: number): IsoDate {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

/** For a Prisma `@db.Date` column: midnight UTC carries the calendar date unchanged. */
export const toDbDate = (d: IsoDate): Date => new Date(`${d}T00:00:00Z`);
export const fromDbDate = (d: Date | null): IsoDate | null => (d ? d.toISOString().slice(0, 10) : null);
