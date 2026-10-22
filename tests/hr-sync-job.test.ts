import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { isStale, notAddedReasonKey, STALE_JOB_MINUTES, summarizeSync } from "../src/lib/hr/sync-job-core";

const logins = {
  created: 2, createdUids: [10, 11], deactivated: 1, suspended: 0, unsuspended: 0,
  lastWorkingDateSet: 3, reviewsRaised: 0, notAdded: {},
};

describe("HR Sync summary", () => {
  test("adds up every date fetched; failed dates contribute nothing", () => {
    const s = summarizeSync(
      [
        { reqDate: "2026-10-20", status: "SUCCEEDED", summary: { received: 8, inserted: 1, updated: 2, rejected: 0, warned: 0 } },
        { reqDate: "2026-10-21", status: "SUCCEEDED", summary: { received: 5, inserted: 0, updated: 3, rejected: 1, warned: 0 } },
        { reqDate: "2026-10-22", status: "FAILED", error: "x", summary: null },
      ],
      4,
      logins,
    );
    assert.deepEqual(s.datesFetched, ["2026-10-20", "2026-10-21"]);
    assert.equal(s.fetched, 13);
    assert.equal(s.newInHr, 1);
    assert.equal(s.changed, 5);
    assert.equal(s.rejected, 1);
    assert.equal(s.resigned, 4);
    assert.equal(s.logins.created, 2);
  });

  test("nothing to fetch is a valid, empty result", () => {
    const s = summarizeSync([], 0, logins);
    assert.deepEqual([s.fetched, s.newInHr, s.changed, s.resigned, s.datesFetched.length], [0, 0, 0, 0, 0]);
  });
});

describe("not-added reasons are grouped for the screen", () => {
  test("every unmapped combination collapses into one line", () => {
    assert.equal(notAddedReasonKey("No mapping for C001 / Mumbai / Sales"), notAddedReasonKey("No mapping for C002 / Pune / (no department)"));
    assert.equal(notAddedReasonKey("Employee code U00001 is not numeric"), "Employee code is not numeric");
    assert.equal(notAddedReasonKey("username SIHL-0123 is already in use"), "Username already in use");
  });
});

describe("stale jobs", () => {
  test(`a job RUNNING for more than ${STALE_JOB_MINUTES} minutes is dead`, () => {
    const now = new Date("2026-10-22T10:00:00Z");
    assert.equal(isStale(new Date("2026-10-22T09:59:00Z"), now), false);
    assert.equal(isStale(new Date(now.getTime() - (STALE_JOB_MINUTES + 1) * 60_000), now), true);
  });
});
