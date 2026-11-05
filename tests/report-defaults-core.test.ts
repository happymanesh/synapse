import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  resolveFilterDefault,
  lastNDaysRange,
  toDateInput,
  QUICK_RANGE_DAYS,
} from "../src/lib/report-defaults-core";

const NOW = new Date(2026, 10, 5, 14, 30); // 05-Nov-2026, afternoon

describe("toDateInput", () => {
  test("formats a local date, not a UTC one", () => {
    // The bug this replaces: toISOString().slice(0,10) returns the UTC date, which in IST
    // is still the previous day until 05:30 — so "today" was wrong every morning.
    assert.equal(toDateInput(new Date(2026, 10, 5, 2, 0)), "2026-11-05");
    assert.equal(toDateInput(new Date(2026, 10, 5, 23, 59)), "2026-11-05");
  });

  test("pads single-digit months and days", () => {
    assert.equal(toDateInput(new Date(2026, 0, 3)), "2026-01-03");
  });
});

describe("lastNDaysRange", () => {
  test("ends today and starts N days back", () => {
    assert.equal(lastNDaysRange(7, NOW), "2026-10-29,2026-11-05");
  });

  test("crosses a month boundary", () => {
    assert.equal(lastNDaysRange(30, NOW), "2026-10-06,2026-11-05");
  });

  test("crosses a year boundary", () => {
    assert.equal(lastNDaysRange(7, new Date(2027, 0, 3)), "2026-12-27,2027-01-03");
  });

  test("produces the from,to shape DATE_RANGE expects", () => {
    const [from, to] = lastNDaysRange(15, NOW).split(",");
    assert.match(from, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(to, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(from < to);
  });
});

describe("resolveFilterDefault", () => {
  test("resolves LAST_N_DAYS for each quick range", () => {
    for (const days of QUICK_RANGE_DAYS) {
      assert.equal(resolveFilterDefault(`LAST_${days}_DAYS`, NOW), lastNDaysRange(days, NOW));
    }
  });

  test("resolves TODAY and YESTERDAY", () => {
    assert.equal(resolveFilterDefault("TODAY", NOW), "2026-11-05");
    assert.equal(resolveFilterDefault("YESTERDAY", NOW), "2026-11-04");
  });

  test("is case-insensitive and tolerates surrounding space", () => {
    assert.equal(resolveFilterDefault("  last_7_days  ", NOW), lastNDaysRange(7, NOW));
  });

  test("leaves a literal default untouched, so existing reports keep working", () => {
    assert.equal(resolveFilterDefault("SIHL", NOW), "SIHL");
    assert.equal(resolveFilterDefault("2026-01-01,2026-03-31", NOW), "2026-01-01,2026-03-31");
  });

  test("empty and absent defaults become an empty value", () => {
    for (const v of ["", null, undefined]) assert.equal(resolveFilterDefault(v, NOW), "");
  });

  test("an unusable window is left visible rather than silently applied", () => {
    // A zero-day or absurd range is a configuration mistake. Returning the token shows the
    // mistake; resolving it to an empty or nonsense range would hide it.
    assert.equal(resolveFilterDefault("LAST_0_DAYS", NOW), "LAST_0_DAYS");
    assert.equal(resolveFilterDefault("LAST_99999_DAYS", NOW), "LAST_99999_DAYS");
  });

  test("an unknown token is returned as itself, not blanked", () => {
    assert.equal(resolveFilterDefault("LAST_FORTNIGHT", NOW), "LAST_FORTNIGHT");
  });
});
