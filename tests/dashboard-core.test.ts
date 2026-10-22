import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildLoginSeries, dayKey, startOfDay, percentChange } from "../src/lib/dashboard-core";

/** Local noon, so a test never straddles a timezone-dependent day boundary. */
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h);
const NOW = at(2026, 10, 23);

describe("dayKey", () => {
  test("uses local date, not UTC", () => {
    // 23:30 local on the 23rd is the 24th in UTC for IST. toISOString() would file this
    // under the wrong day and move a late-evening login into tomorrow's bucket.
    assert.equal(dayKey(at(2026, 10, 23, 23)), "2026-10-23");
    assert.equal(dayKey(at(2026, 1, 5, 0)), "2026-01-05");
  });

  test("pads month and day", () => {
    assert.equal(dayKey(at(2026, 3, 7)), "2026-03-07");
  });
});

describe("startOfDay", () => {
  test("is midnight local on the same date", () => {
    const s = startOfDay(at(2026, 10, 23, 17));
    assert.equal(s.getHours(), 0);
    assert.equal(dayKey(s), "2026-10-23");
  });
});

describe("buildLoginSeries", () => {
  test("always returns one point per day, oldest first", () => {
    const series = buildLoginSeries([], NOW);
    assert.equal(series.length, 7);
    assert.equal(series[0].date, "2026-10-17");
    assert.equal(series[6].date, "2026-10-23");
  });

  test("a day with no attempts is zero, not absent", () => {
    // The reason this is not a GROUP BY: a quiet weekend has no rows, and a chart that
    // plotted only what came back would draw a straight line across the gap.
    const series = buildLoginSeries([{ loginTime: at(2026, 10, 23), status: "SUCCESS" }], NOW);
    assert.equal(series.length, 7);
    assert.deepEqual(
      series.slice(0, 6).map((d) => d.success + d.failure),
      [0, 0, 0, 0, 0, 0]
    );
    assert.equal(series[6].success, 1);
  });

  test("counts successes and failures into the right day", () => {
    const series = buildLoginSeries(
      [
        { loginTime: at(2026, 10, 21), status: "SUCCESS" },
        { loginTime: at(2026, 10, 21), status: "SUCCESS" },
        { loginTime: at(2026, 10, 21), status: "FAILURE" },
        { loginTime: at(2026, 10, 23), status: "FAILURE" },
      ],
      NOW
    );
    const d21 = series.find((d) => d.date === "2026-10-21")!;
    assert.deepEqual([d21.success, d21.failure], [2, 1]);
    const d23 = series.find((d) => d.date === "2026-10-23")!;
    assert.deepEqual([d23.success, d23.failure], [0, 1]);
  });

  test("anything other than SUCCESS counts as a failure", () => {
    // Guards against a new status (LOCKED_OUT_*) silently vanishing from the chart.
    const series = buildLoginSeries([{ loginTime: NOW, status: "LOCKED_OUT_USERNAME" }], NOW);
    assert.equal(series[6].failure, 1);
  });

  test("attempts outside the window are dropped, not clamped to the first day", () => {
    // Clamping would draw a fake spike at the left edge.
    const series = buildLoginSeries([{ loginTime: at(2026, 9, 1), status: "SUCCESS" }], NOW);
    assert.equal(series.reduce((n, d) => n + d.success, 0), 0);
  });

  test("weekday labels line up with the dates", () => {
    const series = buildLoginSeries([], NOW);
    for (const point of series) {
      const expected = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][
        new Date(`${point.date}T00:00:00`).getDay()
      ];
      assert.equal(point.day, expected, `${point.date} labelled ${point.day}`);
    }
  });

  test("honours a custom window length", () => {
    assert.equal(buildLoginSeries([], NOW, 30).length, 30);
  });
});

describe("percentChange", () => {
  test("computes whole-percent movement in both directions", () => {
    assert.equal(percentChange(120, 100), 20);
    assert.equal(percentChange(80, 100), -20);
    assert.equal(percentChange(100, 100), 0);
  });

  test("no baseline yields null rather than Infinity", () => {
    // Rendering "+Infinity%" beside yesterday's zero would be worse than showing nothing.
    assert.equal(percentChange(5, 0), null);
    assert.equal(percentChange(0, 0), null);
  });

  test("rounds to a whole percent", () => {
    assert.equal(percentChange(1, 3), -67);
  });
});
