import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  resolveStatusFilter,
  defaultCreatedRange,
  paginate,
  parseDateInput,
  toDateInputValue,
  endOfDayExclusive,
  startOfDay,
  addDays,
  normalizeText,
  parsePage,
  parseTicketListParams,
  hasActiveFilters,
  PAGE_SIZE,
  CLOSED_WINDOW_DAYS,
} from "../src/lib/ticket-list-core";

describe("resolveStatusFilter", () => {
  test("ANY_OPEN covers every status still being worked on", () => {
    const { statuses, closedWithinDays } = resolveStatusFilter("ANY_OPEN");
    assert.deepEqual(statuses, ["OPEN", "IN_PROGRESS", "FORWARDED", "AWAITING_CR_APPROVAL"]);
    assert.equal(closedWithinDays, null);
  });

  test("ANY_OPEN is not the same as the literal OPEN status", () => {
    // The distinction the whole filter turns on: a ticket someone picked up must not
    // vanish from an outstanding-work list.
    assert.deepEqual(resolveStatusFilter("OPEN").statuses, ["OPEN"]);
    assert.equal(resolveStatusFilter("ANY_OPEN").statuses?.length, 4);
  });

  test("CLOSED_RECENT bounds the window as well as the status", () => {
    const r = resolveStatusFilter("CLOSED_RECENT");
    assert.deepEqual(r.statuses, ["CLOSED"]);
    assert.equal(r.closedWithinDays, CLOSED_WINDOW_DAYS);
  });

  test("an empty value means any status, not no statuses", () => {
    // null, not [] — an empty array would match nothing and show an empty list.
    for (const v of ["", null, undefined]) {
      assert.equal(resolveStatusFilter(v).statuses, null, String(v));
    }
  });

  test("an unknown value is treated as an exact status and simply matches nothing", () => {
    assert.deepEqual(resolveStatusFilter("NONSENSE").statuses, ["NONSENSE"]);
  });
});

describe("parseDateInput", () => {
  test("builds a local date, not a UTC one", () => {
    // new Date("2026-11-05") is UTC midnight = 05:30 IST, which would drop anything
    // raised earlier that morning.
    const d = parseDateInput("2026-11-05")!;
    assert.equal(d.getFullYear(), 2026);
    assert.equal(d.getMonth(), 10);
    assert.equal(d.getDate(), 5);
    assert.equal(d.getHours(), 0);
  });

  test("rejects malformed and impossible dates rather than rolling them forward", () => {
    for (const v of ["", "not-a-date", "2026-13-01", "2026-02-31", "05-11-2026", null, undefined]) {
      assert.equal(parseDateInput(v), null, String(v));
    }
  });

  test("round-trips through toDateInputValue", () => {
    const d = new Date(2026, 0, 3);
    assert.equal(toDateInputValue(d), "2026-01-03");
    assert.deepEqual(parseDateInput(toDateInputValue(d)), d);
  });
});

describe("day boundaries", () => {
  test("endOfDayExclusive is the next midnight, so the whole day is inside the range", () => {
    const d = new Date(2026, 10, 5, 13, 45, 12, 400);
    const end = endOfDayExclusive(d);
    assert.equal(end.getDate(), 6);
    assert.equal(end.getHours(), 0);
    // The case an inclusive 23:59:59 bound would lose.
    assert.ok(new Date(2026, 10, 5, 23, 59, 59, 400) < end);
  });

  test("startOfDay strips the time", () => {
    assert.equal(startOfDay(new Date(2026, 10, 5, 23, 59)).getHours(), 0);
  });

  test("addDays crosses month and year ends", () => {
    assert.equal(toDateInputValue(addDays(new Date(2026, 11, 31), 1)), "2027-01-01");
    assert.equal(toDateInputValue(addDays(new Date(2026, 0, 1), -1)), "2025-12-31");
  });
});

describe("defaultCreatedRange", () => {
  const today = new Date(2026, 10, 5); // 05-Nov-2026

  test("starts at the oldest open ticket when that is inside the cap", () => {
    const oldest = new Date(2026, 9, 20, 14, 30); // 20-Oct, 16 days back
    const r = defaultCreatedRange(oldest, today);
    assert.equal(toDateInputValue(r.from), "2026-10-20");
    assert.equal(toDateInputValue(r.to), "2026-11-05");
  });

  test("floors at 90 days when the oldest open ticket is older", () => {
    const r = defaultCreatedRange(new Date(2025, 0, 1), today);
    assert.equal(toDateInputValue(r.from), toDateInputValue(addDays(today, -90)));
  });

  test("falls back to the 90-day window when nothing is open", () => {
    const r = defaultCreatedRange(null, today);
    assert.equal(toDateInputValue(r.from), toDateInputValue(addDays(today, -90)));
    assert.equal(toDateInputValue(r.to), "2026-11-05");
  });

  test("never returns from > to, even with a future raised date", () => {
    const r = defaultCreatedRange(new Date(2027, 0, 1), today);
    assert.ok(r.from <= r.to);
  });

  test("drops the time component so the whole first day is included", () => {
    const r = defaultCreatedRange(new Date(2026, 9, 20, 23, 59), today);
    assert.equal(r.from.getHours(), 0);
  });
});

describe("paginate", () => {
  test("splits a list into pages of 25", () => {
    const p = paginate(180, 1);
    assert.equal(p.pages, 8);
    assert.equal(p.skip, 0);
    assert.equal(p.take, PAGE_SIZE);
    assert.equal(p.firstRow, 1);
    assert.equal(p.lastRow, 25);
  });

  test("reports the right row window on a middle page", () => {
    const p = paginate(180, 2);
    assert.equal(p.skip, 25);
    assert.equal(p.firstRow, 26);
    assert.equal(p.lastRow, 50);
  });

  test("the last page is short, not padded", () => {
    const p = paginate(180, 8);
    assert.equal(p.firstRow, 176);
    assert.equal(p.lastRow, 180);
  });

  test("clamps a page past the end to the last page", () => {
    // ?page=9999 should show the last page, not an empty table that reads as "no matches".
    assert.equal(paginate(60, 9999).page, 3);
  });

  test("clamps zero, negative and nonsense to page 1", () => {
    for (const p of [0, -5, Number.NaN]) assert.equal(paginate(60, p).page, 1);
  });

  test("an empty result is one page with no rows", () => {
    const p = paginate(0, 1);
    assert.equal(p.pages, 1);
    assert.equal(p.firstRow, 0);
    assert.equal(p.lastRow, 0);
  });

  test("exactly one full page does not produce a second empty one", () => {
    assert.equal(paginate(25, 1).pages, 1);
  });
});

describe("normalizeText and parsePage", () => {
  test("whitespace-only text is no filter at all", () => {
    assert.equal(normalizeText("   "), null);
    assert.equal(normalizeText(""), null);
    assert.equal(normalizeText(undefined), null);
    assert.equal(normalizeText("  TKT-2026  "), "TKT-2026");
  });

  test("a bad page falls back to 1", () => {
    for (const v of ["", "abc", "-2", "0", undefined]) assert.equal(parsePage(v), 1);
    assert.equal(parsePage("4"), 4);
  });
});

describe("parseTicketListParams", () => {
  test("an absent status takes the caller's default", () => {
    assert.equal(parseTicketListParams({}).status, "ANY_OPEN");
    assert.equal(parseTicketListParams({}, { status: "CLOSED_RECENT" }).status, "CLOSED_RECENT");
  });

  test("an explicitly empty status means Any, and is not overwritten by the default", () => {
    // Without this, clearing the status filter would silently snap back to Open.
    assert.equal(parseTicketListParams({ status: "" }, { status: "ANY_OPEN" }).status, "");
  });

  test("reads every column filter", () => {
    const f = parseTicketListParams({
      ticketNo: "TKT-2026-000001",
      subject: " position ",
      ticketType: "ISSUE",
      applicationId: "4",
      segmentId: "2",
      channel: "PHONE",
      assignedTo: "Priya",
      raisedBy: "Ranjeeta",
      from: "2026-10-01",
      to: "2026-11-05",
      page: "3",
    });
    assert.equal(f.ticketNo, "TKT-2026-000001");
    assert.equal(f.subject, "position");
    assert.equal(f.applicationId, 4);
    assert.equal(f.segmentId, 2);
    assert.equal(f.channel, "PHONE");
    assert.equal(f.assignedTo, "Priya");
    assert.equal(f.raisedBy, "Ranjeeta");
    assert.equal(toDateInputValue(f.from!), "2026-10-01");
    assert.equal(f.page, 3);
  });

  test("takes the first value when a param repeats", () => {
    assert.equal(parseTicketListParams({ subject: ["one", "two"] }).subject, "one");
  });

  test("a non-numeric id is no filter rather than NaN", () => {
    assert.equal(parseTicketListParams({ applicationId: "abc" }).applicationId, null);
    assert.equal(parseTicketListParams({ applicationId: "0" }).applicationId, null);
  });
});

describe("hasActiveFilters", () => {
  test("false on a bare default view", () => {
    assert.equal(hasActiveFilters(parseTicketListParams({}), "ANY_OPEN"), false);
  });

  test("true once any column is narrowed", () => {
    assert.equal(hasActiveFilters(parseTicketListParams({ subject: "x" }), "ANY_OPEN"), true);
  });

  test("true when the status differs from the page's default", () => {
    assert.equal(hasActiveFilters(parseTicketListParams({ status: "CLOSED" }), "ANY_OPEN"), true);
  });

  test("paging alone is not a filter", () => {
    assert.equal(hasActiveFilters(parseTicketListParams({ page: "3" }), "ANY_OPEN"), false);
  });
});
