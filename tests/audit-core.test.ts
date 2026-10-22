import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { redact, diffRecords, isAuditedModel, recordIdOf, REDACTED } from "../src/lib/audit-core";

describe("redact", () => {
  test("never lets a password hash into the audit log", () => {
    // The audit screen is readable by more people than user_details is. A hash copied
    // here widens exposure of the most sensitive column in the database.
    const out = redact({ username: "SIHL-0720", passwordHash: "$2a$10$abcdef" }) as Record<string, unknown>;
    assert.equal(out.username, "SIHL-0720");
    assert.equal(out.passwordHash, REDACTED);
  });

  test("matches on the field name, so a new model is covered the day it is added", () => {
    const out = redact({
      apiKey: "k",
      api_key: "k",
      sessionToken: "t",
      clientSecret: "s",
      privateKey: "p",
      passwordSalt: "x",
    }) as Record<string, string>;
    for (const [k, v] of Object.entries(out)) assert.equal(v, REDACTED, `${k} not redacted`);
  });

  test("redacts inside nested objects and arrays", () => {
    const out = redact({ users: [{ name: "a", password: "p" }], meta: { token: "t" } }) as {
      users: { name: string; password: string }[];
      meta: { token: string };
    };
    assert.equal(out.users[0].password, REDACTED);
    assert.equal(out.users[0].name, "a");
    assert.equal(out.meta.token, REDACTED);
  });

  test("is case-insensitive", () => {
    const out = redact({ PASSWORD: "x", Token: "y" }) as Record<string, string>;
    assert.equal(out.PASSWORD, REDACTED);
    assert.equal(out.Token, REDACTED);
  });

  test("leaves ordinary values alone and stringifies dates", () => {
    const d = new Date("2026-10-23T10:00:00.000Z");
    const out = redact({ n: 1, s: "x", b: true, nil: null, when: d }) as Record<string, unknown>;
    assert.deepEqual(out, { n: 1, s: "x", b: true, nil: null, when: "2026-10-23T10:00:00.000Z" });
  });

  test("stops recursing rather than hanging on a deep structure", () => {
    let deep: Record<string, unknown> = { password: "p" };
    for (let i = 0; i < 50; i++) deep = { nested: deep };
    assert.doesNotThrow(() => redact(deep));
  });
});

describe("diffRecords", () => {
  test("records only the fields that moved", () => {
    // Saving a form writes every field back. Recording all forty would bury the one
    // that actually changed.
    const changes = diffRecords(
      { fullName: "A", email: "a@x.com", isActive: true },
      { fullName: "A", email: "b@x.com", isActive: true }
    );
    assert.deepEqual(Object.keys(changes), ["email"]);
    assert.deepEqual(changes.email, { from: "a@x.com", to: "b@x.com" });
  });

  test("an unchanged save produces nothing", () => {
    assert.deepEqual(diffRecords({ a: 1 }, { a: 1 }), {});
  });

  test("a changed sensitive field is reported as changed, but not what to", () => {
    const changes = diffRecords({ passwordHash: "old" }, { passwordHash: "new" });
    assert.deepEqual(changes.passwordHash, { from: REDACTED, to: REDACTED });
  });

  test("an equal Date and ISO string do not read as a change", () => {
    const iso = "2026-10-23T10:00:00.000Z";
    assert.deepEqual(diffRecords({ at: new Date(iso) }, { at: new Date(iso) }), {});
  });

  test("null to a value, and back, are both changes", () => {
    assert.ok("email" in diffRecords({ email: null }, { email: "a@x.com" }));
    assert.ok("email" in diffRecords({ email: "a@x.com" }, { email: null }));
  });

  test("a missing before or after yields nothing rather than a false full-row diff", () => {
    assert.deepEqual(diffRecords(null, { a: 1 }), {});
    assert.deepEqual(diffRecords({ a: 1 }, null), {});
  });
});

describe("isAuditedModel", () => {
  test("administrative models are audited", () => {
    for (const m of ["ReportDefinition", "UserDetails", "RoleMenuMap", "MenuMaster", "AppMaster"]) {
      assert.equal(isAuditedModel(m), true, `${m} should be audited`);
    }
  });

  test("the audit log itself is not, or it would recurse", () => {
    assert.equal(isAuditedModel("AuditLog"), false);
  });

  test("high-volume machine logs are not audited", () => {
    for (const m of ["LoginLog", "MenuUsageLog", "HrRawEmployee", "PasswordHistory"]) {
      assert.equal(isAuditedModel(m), false, `${m} should not be audited`);
    }
  });

  test("an undefined model is not audited", () => {
    assert.equal(isAuditedModel(undefined), false);
  });
});

describe("recordIdOf", () => {
  test("finds a numeric id or uid", () => {
    assert.equal(recordIdOf({ id: 7 }), "7");
    assert.equal(recordIdOf({ uid: 14 }), "14");
  });

  test("finds a code key, since most masters are keyed by code not id", () => {
    assert.equal(recordIdOf({ companyCode: "SIHL" }), "SIHL");
    assert.equal(recordIdOf({ reportId: "SALES_REPORT" }), "SALES_REPORT");
  });

  test("returns null rather than guessing when nothing identifies the row", () => {
    assert.equal(recordIdOf({ someField: "x" }), null);
    assert.equal(recordIdOf(null), null);
  });
});
