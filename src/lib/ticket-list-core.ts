/**
 * Pure rules for the filtered, paged ticket lists (My Tickets and the Triage Queue).
 *
 * Deliberately free of `server-only` and of any Prisma import so it can be unit tested
 * directly (see tests/ticket-list-core.test.ts). `@/lib/tickets` is the DB-backed layer.
 *
 * Everything here turns URL search params into something a query can use. Filter state
 * lives in the URL rather than component state so a filtered view can be bookmarked,
 * shared, survives a refresh, and works with the back button — and so the Triage Queue's
 * status boxes are just links rather than a second filtering mechanism.
 */

import { OPEN_STATUSES } from "./ticket-core";

/** How long a page is. Fixed rather than user-chosen: a page size in the URL is one more
 *  thing to get wrong, and nobody has asked to change it. */
export const PAGE_SIZE = 25;

/** The window "recently closed" means, here and on the Triage Queue's closed box. */
export const CLOSED_WINDOW_DAYS = 90;

/** How far back a default date range may reach before it is capped. */
export const DEFAULT_RANGE_MAX_DAYS = 90;

/**
 * The status dropdown.
 *
 * `ANY_OPEN` is a group, not a status: it covers everything still being worked on. A list
 * defaulting to the literal `OPEN` status would hide a ticket the moment someone picked it
 * up and moved it to IN_PROGRESS, which is the opposite of what an outstanding-work list is
 * for. The individual statuses are still selectable underneath it.
 */
export const STATUS_FILTERS = [
  { value: "ANY_OPEN", label: "Open (all active)" },
  { value: "OPEN", label: "Open" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "FORWARDED", label: "Forwarded" },
  { value: "AWAITING_CR_APPROVAL", label: "Awaiting CR approval" },
  { value: "RESOLVED", label: "Resolved" },
  { value: "CLOSED_RECENT", label: `Closed (last ${CLOSED_WINDOW_DAYS} days)` },
  { value: "CLOSED", label: "Closed (all)" },
  { value: "MERGED", label: "Merged" },
  { value: "", label: "Any status" },
] as const;

export interface StatusSelection {
  /** Statuses to match, or null for "any". */
  statuses: string[] | null;
  /** When set, also require closedAt within this many days. */
  closedWithinDays: number | null;
}

export function resolveStatusFilter(value: string | null | undefined): StatusSelection {
  switch (value) {
    case "ANY_OPEN":
      return { statuses: [...OPEN_STATUSES], closedWithinDays: null };
    case "CLOSED_RECENT":
      return { statuses: ["CLOSED"], closedWithinDays: CLOSED_WINDOW_DAYS };
    case undefined:
    case null:
    case "":
      return { statuses: null, closedWithinDays: null };
    default:
      return { statuses: [value], closedWithinDays: null };
  }
}

/** Midnight at the start of the given calendar day, in the server's own zone. */
export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

/** The first instant of the NEXT day — an exclusive upper bound.
 *
 *  Exclusive rather than 23:59:59 because a ticket raised at 23:59:59.400 on the "to" date
 *  is inside the range the user asked for, and an inclusive second-granularity bound would
 *  silently drop it. */
export function endOfDayExclusive(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0);
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, 0, 0, 0, 0);
}

/** `yyyy-mm-dd`, the value an <input type="date"> expects. */
export function toDateInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * `yyyy-mm-dd` to a local Date, or null.
 *
 * Built from parts rather than `new Date(string)`: the string form is parsed as UTC
 * midnight, which in IST is 05:30 on the same day — so a range starting "today" would
 * silently exclude anything raised before half past five in the morning.
 */
export function parseDateInput(value: string | null | undefined): Date | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d, 0, 0, 0, 0);
  // Rejects 2026-02-31 and friends, which Date would roll forward into March.
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return date;
}

export interface DateRange {
  from: Date;
  to: Date;
}

/**
 * The default Created range for My Tickets.
 *
 * From the raised date of the oldest ticket still open, so nothing outstanding is hidden by
 * the default — but floored at `maxDays` back, so one forgotten ticket from last year does
 * not silently widen every page load into a full-table scan. To is always today.
 *
 * With nothing open, falls back to the same `maxDays` window rather than showing an empty
 * list: a user whose tickets are all closed should still see recent history.
 */
export function defaultCreatedRange(
  oldestOpenRaisedAt: Date | null,
  today: Date,
  maxDays: number = DEFAULT_RANGE_MAX_DAYS
): DateRange {
  const floor = addDays(startOfDay(today), -maxDays);
  const to = startOfDay(today);
  if (!oldestOpenRaisedAt) return { from: floor, to };
  const oldest = startOfDay(oldestOpenRaisedAt);
  // A raised date in the future would otherwise produce from > to and an always-empty list.
  const from = oldest > to ? to : oldest < floor ? floor : oldest;
  return { from, to };
}

export interface PageWindow {
  /** The page actually shown, after clamping. */
  page: number;
  pages: number;
  skip: number;
  take: number;
  /** 1-based row numbers of this page, for "showing 26–50 of 180". Zero when empty. */
  firstRow: number;
  lastRow: number;
  total: number;
}

/**
 * Where a page starts and ends.
 *
 * Clamps rather than trusting the URL: ?page=9999 on a three-page list should show the last
 * page, not an empty table that looks like the filter matched nothing.
 */
export function paginate(total: number, requestedPage: number, pageSize: number = PAGE_SIZE): PageWindow {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, Math.floor(requestedPage) || 1), pages);
  const skip = (page - 1) * pageSize;
  return {
    page,
    pages,
    skip,
    take: pageSize,
    firstRow: total === 0 ? 0 : skip + 1,
    lastRow: Math.min(skip + pageSize, total),
    total,
  };
}

/** A text filter, or null when it would match everything anyway. */
export function normalizeText(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function parsePage(value: string | null | undefined): number {
  const n = Number.parseInt((value ?? "").trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** The column filters both lists share. */
export interface TicketListFilters {
  ticketNo: string | null;
  subject: string | null;
  ticketType: string | null;
  applicationId: number | null;
  segmentId: number | null;
  channel: string | null;
  status: string;
  from: Date | null;
  to: Date | null;
  page: number;
  /** Triage only: the person a ticket sits with. */
  assignedTo: string | null;
  /** Triage only: who raised it. */
  raisedBy: string | null;
}

function parseId(value: string | null | undefined): number | null {
  const n = Number.parseInt((value ?? "").trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Read the filters out of a URL's search params.
 *
 * Takes a plain record rather than URLSearchParams so a Next.js `searchParams` object can be
 * passed straight in, and so the tests need no DOM.
 */
export function parseTicketListParams(
  params: Record<string, string | string[] | undefined>,
  defaults: { status?: string } = {}
): TicketListFilters {
  const one = (key: string): string | null => {
    const v = params[key];
    if (Array.isArray(v)) return v[0] ?? null;
    return v ?? null;
  };

  // An explicitly empty status means "Any status"; an absent one means the caller's default.
  const rawStatus = one("status");
  const status = rawStatus === null ? (defaults.status ?? "ANY_OPEN") : rawStatus;

  return {
    ticketNo: normalizeText(one("ticketNo")),
    subject: normalizeText(one("subject")),
    ticketType: normalizeText(one("ticketType")),
    applicationId: parseId(one("applicationId")),
    segmentId: parseId(one("segmentId")),
    channel: normalizeText(one("channel")),
    status,
    from: parseDateInput(one("from")),
    to: parseDateInput(one("to")),
    page: parsePage(one("page")),
    assignedTo: normalizeText(one("assignedTo")),
    raisedBy: normalizeText(one("raisedBy")),
  };
}

/** True when the user has narrowed anything beyond the defaults — drives the "Clear" button. */
export function hasActiveFilters(f: TicketListFilters, defaultStatus: string): boolean {
  return (
    f.ticketNo !== null ||
    f.subject !== null ||
    f.ticketType !== null ||
    f.applicationId !== null ||
    f.segmentId !== null ||
    f.channel !== null ||
    f.assignedTo !== null ||
    f.raisedBy !== null ||
    f.status !== defaultStatus
  );
}
