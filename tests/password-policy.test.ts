import { test, describe } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import {
  checkPasswordPolicy,
  isPasswordReused,
  validatePasswordChangeRequest,
  MAX_PASSWORD_BYTES,
} from "../src/lib/password-policy";

const GOOD = "Synapse@2026";

describe("checkPasswordPolicy", () => {
  test("accepts a password meeting every rule", () => {
    assert.deepEqual(checkPasswordPolicy(GOOD, "Admin001"), { valid: true, errors: [] });
  });

  test("names every broken rule at once, so one attempt shows the whole gap", () => {
    const result = checkPasswordPolicy("abc", "Admin001");
    assert.equal(result.valid, false);
    assert.equal(result.errors.length, 4); // length, uppercase, digit, special
  });

  test("rejects a password equal to the username, ignoring case", () => {
    const result = checkPasswordPolicy("Admin001", "admin001");
    assert.ok(result.errors.some((e) => e.includes("same as the username")));
  });

  test("rejects a password longer than bcrypt will hash", () => {
    // Without this, the tail is silently ignored and a shorter password would let you in.
    const tooLong = "A1!" + "a".repeat(MAX_PASSWORD_BYTES);
    assert.ok(checkPasswordPolicy(tooLong, "Admin001").errors.some((e) => e.includes("too long")));
  });

  test("measures the cap in bytes, not characters", () => {
    // 30 Devanagari characters are 90 bytes — under any character count, over the limit.
    const devanagari = "A1!" + "अ".repeat(30);
    assert.ok(devanagari.length < MAX_PASSWORD_BYTES);
    assert.ok(checkPasswordPolicy(devanagari, "Admin001").errors.some((e) => e.includes("too long")));
  });

  test("a password exactly at the cap is allowed", () => {
    const exact = "A1!" + "a".repeat(MAX_PASSWORD_BYTES - 3);
    assert.equal(new TextEncoder().encode(exact).length, MAX_PASSWORD_BYTES);
    assert.equal(checkPasswordPolicy(exact, "Admin001").valid, true);
  });
});

describe("isPasswordReused", () => {
  test("recognises a password behind one of the stored hashes", async () => {
    const hashes = [await bcrypt.hash("Other@2025", 4), await bcrypt.hash(GOOD, 4)];
    assert.equal(await isPasswordReused(GOOD, hashes), true);
  });

  test("is false against an empty history — a never-changed account is not blocked", async () => {
    assert.equal(await isPasswordReused(GOOD, []), false);
  });

  test("is false for a genuinely new password", async () => {
    assert.equal(await isPasswordReused("Brand@New9", [await bcrypt.hash(GOOD, 4)]), false);
  });
});

describe("validatePasswordChangeRequest", () => {
  const body = { currentPassword: "Old@Pass1", newPassword: GOOD, confirmPassword: GOOD };

  test("accepts a well-formed request and hands back the two passwords", () => {
    const result = validatePasswordChangeRequest(body, "Admin001");
    assert.deepEqual(result, { ok: true, currentPassword: "Old@Pass1", newPassword: GOOD });
  });

  test("rejects a missing field", () => {
    for (const field of ["currentPassword", "newPassword", "confirmPassword"]) {
      const result = validatePasswordChangeRequest({ ...body, [field]: "" }, "Admin001");
      assert.equal(result.ok, false, field);
    }
  });

  test("rejects a non-string field rather than coercing it", () => {
    const result = validatePasswordChangeRequest({ ...body, newPassword: 12345678 }, "Admin001");
    assert.equal(result.ok, false);
  });

  test("survives a null or malformed body — the route passes whatever JSON.parse gave it", () => {
    assert.equal(validatePasswordChangeRequest(null, "Admin001").ok, false);
    assert.equal(validatePasswordChangeRequest("not an object", "Admin001").ok, false);
  });

  test("rejects a mismatched confirmation", () => {
    const result = validatePasswordChangeRequest({ ...body, confirmPassword: "Synapse@2027" }, "Admin001");
    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.error.includes("do not match"));
  });

  test("rejects a no-op change", () => {
    const same = { currentPassword: GOOD, newPassword: GOOD, confirmPassword: GOOD };
    const result = validatePasswordChangeRequest(same, "Admin001");
    assert.ok(!result.ok && result.error.includes("different from your current password"));
  });

  test("applies the policy to the new password, against the caller's own username", () => {
    const weak = { currentPassword: "Old@Pass1", newPassword: "admin001", confirmPassword: "admin001" };
    const result = validatePasswordChangeRequest(weak, "Admin001");
    assert.ok(!result.ok && result.error.includes("same as the username"));
  });

  test("reports the mismatch before the policy — one problem at a time, in fixing order", () => {
    const both = { currentPassword: "Old@Pass1", newPassword: "weak", confirmPassword: "other" };
    const result = validatePasswordChangeRequest(both, "Admin001");
    assert.ok(!result.ok && result.error.includes("do not match"));
    assert.ok(!result.ok && !result.error.includes("uppercase"));
  });
});
