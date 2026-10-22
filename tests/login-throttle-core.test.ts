import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_FAILURES_PER_USERNAME,
  MAX_FAILURES_PER_IP,
  LOCKOUT_WINDOW_MS,
  LOCKOUT_WINDOW_MINUTES,
  windowStart,
  countFrom,
  lockoutReason,
  lockoutMessage,
} from "../src/lib/login-throttle-core";

const NOW = new Date("2026-10-22T17:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

describe("windowStart", () => {
  test("is exactly the window behind now", () => {
    assert.equal(windowStart(NOW).getTime(), NOW.getTime() - LOCKOUT_WINDOW_MS);
  });
});

describe("countFrom", () => {
  test("with no successful sign-in ever, counts the whole window", () => {
    assert.equal(countFrom(NOW, null).getTime(), windowStart(NOW).getTime());
  });

  test("a success inside the window clears everything before it", () => {
    // Five failures then a success then one failure must read as one, not six —
    // otherwise a user who just signed in correctly is locked out by old noise.
    const success = ago(5 * 60 * 1000);
    assert.equal(countFrom(NOW, success).getTime(), success.getTime());
  });

  test("a success older than the window does not widen the window", () => {
    const old = ago(LOCKOUT_WINDOW_MS * 3);
    assert.equal(countFrom(NOW, old).getTime(), windowStart(NOW).getTime());
  });

  test("a success exactly at the window edge is not treated as inside it", () => {
    assert.equal(countFrom(NOW, windowStart(NOW)).getTime(), windowStart(NOW).getTime());
  });
});

describe("lockoutReason", () => {
  test("under both limits is not locked", () => {
    assert.equal(lockoutReason(MAX_FAILURES_PER_USERNAME - 1, MAX_FAILURES_PER_IP - 1), null);
  });

  test("locks at the username limit, not one past it", () => {
    assert.equal(lockoutReason(MAX_FAILURES_PER_USERNAME, 0), "USERNAME");
  });

  test("locks on IP even when each username stayed under its own limit", () => {
    // The rotating-username attack: never more than a couple of tries per account,
    // but hundreds from one address.
    assert.equal(lockoutReason(1, MAX_FAILURES_PER_IP), "IP");
  });

  test("username takes precedence when both are over", () => {
    assert.equal(lockoutReason(MAX_FAILURES_PER_USERNAME, MAX_FAILURES_PER_IP), "USERNAME");
  });

  test("zero failures is never locked", () => {
    assert.equal(lockoutReason(0, 0), null);
  });

  test("the IP limit is looser than the username limit", () => {
    // A branch office behind one NAT address must not lock out on a few genuine typos.
    assert.ok(MAX_FAILURES_PER_IP > MAX_FAILURES_PER_USERNAME);
  });
});

describe("lockoutMessage", () => {
  test("never reveals whether the username exists", () => {
    for (const reason of ["USERNAME", "IP"] as const) {
      const msg = lockoutMessage(reason);
      assert.ok(!/no such|unknown|not found|does not exist/i.test(msg), `leaks existence: ${msg}`);
    }
  });

  test("tells the user how long to wait", () => {
    assert.ok(lockoutMessage("USERNAME").includes(String(LOCKOUT_WINDOW_MINUTES)));
    assert.ok(lockoutMessage("IP").includes(String(LOCKOUT_WINDOW_MINUTES)));
  });

  test("the two reasons read differently, so logs and users can tell them apart", () => {
    assert.notEqual(lockoutMessage("USERNAME"), lockoutMessage("IP"));
  });
});
