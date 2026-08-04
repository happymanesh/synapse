import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ipMatchesPattern, isIpAllowed, getClientIp } from "../src/lib/ip-match";
import { checkPasswordPolicy, isPasswordReused } from "../src/lib/password-policy";
import bcrypt from "bcryptjs";

describe("ipMatchesPattern", () => {
  test("exact match", () => {
    assert.equal(ipMatchesPattern("192.168.1.10", "192.168.1.10"), true);
    assert.equal(ipMatchesPattern("192.168.1.11", "192.168.1.10"), false);
  });

  test("wildcard octets", () => {
    assert.equal(ipMatchesPattern("192.168.5.9", "192.168.*.*"), true);
    assert.equal(ipMatchesPattern("10.0.0.1", "192.168.*.*"), false);
    assert.equal(ipMatchesPattern("192.168.5.9", "*.*.*.*"), true);
  });

  test("wildcards match a whole octet, not a prefix", () => {
    // '1' must not be treated as matching '10' — a substring match here would
    // silently widen every restriction that uses wildcards.
    assert.equal(ipMatchesPattern("192.168.1.1", "192.168.1.*"), true);
    assert.equal(ipMatchesPattern("192.168.10.1", "192.168.1.*"), false);
  });

  test("malformed input never accidentally matches", () => {
    assert.equal(ipMatchesPattern("192.168.1", "192.168.1.*"), false);
    assert.equal(ipMatchesPattern("192.168.1.10", "192.168.1"), false);
    assert.equal(ipMatchesPattern("", "*.*.*.*"), false);
  });
});

describe("isIpAllowed", () => {
  test("no mappings at all means unrestricted", () => {
    assert.equal(isIpAllowed("203.0.113.7", []), true);
  });

  test("only inactive mappings also means unrestricted", () => {
    assert.equal(isIpAllowed("203.0.113.7", [{ ipMapping: "10.0.0.1", isActive: false }]), true);
  });

  test("an active mapping restricts to matching addresses", () => {
    const mappings = [{ ipMapping: "192.168.*.*", isActive: true }];
    assert.equal(isIpAllowed("192.168.4.4", mappings), true);
    assert.equal(isIpAllowed("203.0.113.7", mappings), false);
  });

  test("matching any one active mapping is enough", () => {
    const mappings = [
      { ipMapping: "10.0.0.*", isActive: true },
      { ipMapping: "192.168.*.*", isActive: true },
    ];
    assert.equal(isIpAllowed("192.168.9.9", mappings), true);
  });

  test("an inactive mapping cannot grant access on its own", () => {
    const mappings = [
      { ipMapping: "10.0.0.*", isActive: true },
      { ipMapping: "203.0.113.*", isActive: false },
    ];
    assert.equal(isIpAllowed("203.0.113.7", mappings), false);
  });
});

describe("getClientIp", () => {
  test("prefers the first x-forwarded-for entry", () => {
    const h = new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" });
    assert.equal(getClientIp(h), "203.0.113.7");
  });
  test("falls back to x-real-ip, then loopback", () => {
    assert.equal(getClientIp(new Headers({ "x-real-ip": "198.51.100.2" })), "198.51.100.2");
    assert.equal(getClientIp(new Headers()), "127.0.0.1");
  });
});

describe("checkPasswordPolicy", () => {
  test("accepts a compliant password", () => {
    assert.equal(checkPasswordPolicy("Str0ng@Pass", "someone").valid, true);
  });

  const rejections: [string, string, RegExp][] = [
    ["too short", "Ab1@x", /8 characters/i],
    ["no uppercase", "weak1@pass", /uppercase/i],
    ["no digit", "Weak@Password", /number/i],
    ["no special character", "Weak1Password", /special/i],
  ];
  for (const [name, password, expected] of rejections) {
    test(name, () => {
      const result = checkPasswordPolicy(password, "someone");
      assert.equal(result.valid, false);
      assert.ok(result.errors.some((e) => expected.test(e)), `expected an error matching ${expected}`);
    });
  }

  test("rejects a password equal to the username, case-insensitively", () => {
    const result = checkPasswordPolicy("Admin@123", "admin@123");
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => /same as the username/i.test(e)));
  });

  test("reports every violation at once rather than stopping at the first", () => {
    const result = checkPasswordPolicy("abc", "someone");
    assert.ok(result.errors.length >= 3, `expected several errors, got ${result.errors.length}`);
  });
});

describe("isPasswordReused", () => {
  test("detects a previously used password", async () => {
    const hashes = [await bcrypt.hash("OldPass@1", 10), await bcrypt.hash("OlderPass@2", 10)];
    assert.equal(await isPasswordReused("OldPass@1", hashes), true);
    assert.equal(await isPasswordReused("BrandNew@3", hashes), false);
  });

  test("empty history means nothing is reused", async () => {
    assert.equal(await isPasswordReused("Anything@1", []), false);
  });
});
