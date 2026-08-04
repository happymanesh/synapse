import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  assertSelectOnly,
  assertSafeIdentifier,
  bindNamedParams,
  buildParamValues,
  resolveFilterValue,
  isFilterValuePresent,
  withSessionParams,
  wrapWithScope,
} from "../src/lib/sql-core";

const scope = { companyCode: "SIHL", hierarchyCode: "0100", username: "Admin001", userUid: 2 };

describe("assertSelectOnly — legitimate reads must pass", () => {
  const allowed = [
    "SELECT * FROM sample_sales",
    "  select company_code from sample_sales  ",
    "WITH t AS (SELECT 1 AS n) SELECT * FROM t",
    "SELECT * FROM sample_sales WHERE sale_date >= :FROM_DATE",
    "SELECT * FROM sample_sales;",                       // single trailing semicolon is fine
    // Column names that merely contain a dangerous word.
    "SELECT last_update, delete_flag, created_by FROM t",
    "SELECT start, stop FROM trip",                      // bare word list would reject this
    "SELECT id FROM t ORDER BY id OFFSET 10",            // OFFSET contains SET
    "SELECT setseed(0.5)",                               // setseed starts with SET
    // Dangerous words appearing only inside string literals or comments.
    "SELECT * FROM t WHERE note = 'please update this'",
    "SELECT * FROM t -- DELETE FROM t",
    "SELECT * FROM t /* DROP TABLE t */",
  ];
  for (const sql of allowed) {
    test(sql.trim().slice(0, 58), () => assert.doesNotThrow(() => assertSelectOnly(sql)));
  }
});

describe("assertSelectOnly — writes and bypasses must be rejected", () => {
  const rejected: [string, string][] = [
    ["plain delete", "DELETE FROM sample_sales"],
    ["plain update", "UPDATE sample_sales SET amount = 0"],
    ["plain insert", "INSERT INTO sample_sales (id) VALUES (1)"],
    ["drop table", "DROP TABLE sample_sales"],
    ["truncate", "TRUNCATE sample_sales"],
    ["grant", "GRANT ALL ON sample_sales TO PUBLIC"],
    // Second statement smuggled after a semicolon.
    ["stacked statement", "SELECT 1; DROP TABLE sample_sales"],
    ["stacked delete", "SELECT * FROM t; DELETE FROM t"],
    // Postgres genuinely allows data-modifying statements inside a CTE, so
    // "begins with WITH" alone would let these through.
    ["writable CTE delete", "WITH gone AS (DELETE FROM sample_sales RETURNING *) SELECT * FROM gone"],
    ["writable CTE update", "WITH x AS (UPDATE sample_sales SET amount = 0 RETURNING *) SELECT * FROM x"],
    ["writable CTE insert", "WITH x AS (INSERT INTO sample_sales (id) VALUES (1) RETURNING *) SELECT * FROM x"],
    // Comment tricks: the payload is real SQL, the comment only hides it from a naive scan.
    ["comment-hidden write", "SELECT * FROM t /* harmless */ ; DROP TABLE t"],
    ["do block", "DO $$ BEGIN PERFORM 1; END $$"],
    ["empty", "   "],
  ];
  for (const [name, sql] of rejected) {
    test(name, () => assert.throws(() => assertSelectOnly(sql), /read-only|single statement|may not contain|empty/i));
  }
});

describe("assertSafeIdentifier", () => {
  test("accepts plain identifiers", () => {
    for (const ok of ["id", "company_code", "_x", "T1"]) {
      assert.doesNotThrow(() => assertSafeIdentifier(ok));
    }
  });
  test("rejects injection attempts", () => {
    for (const bad of ["a b", "a;b", 'a"b', "a-b", "1abc", "", "a'", "t WHERE 1=1"]) {
      assert.throws(() => assertSafeIdentifier(bad), /Unsafe SQL identifier/);
    }
  });
});

describe("bindNamedParams", () => {
  test("replaces tokens positionally and collects values in order", () => {
    const { sql, params } = bindNamedParams("SELECT * FROM t WHERE a = :A AND b = :B", { A: 1, B: "x" });
    assert.equal(sql, "SELECT * FROM t WHERE a = $1 AND b = $2");
    assert.deepEqual(params, [1, "x"]);
  });

  test("reuses one placeholder for a repeated parameter", () => {
    const { sql, params } = bindNamedParams("SELECT * FROM t WHERE a = :A OR b = :A", { A: 7 });
    assert.equal(sql, "SELECT * FROM t WHERE a = $1 OR b = $1");
    assert.deepEqual(params, [7]);
  });

  test("missing values bind as null rather than being left in the SQL", () => {
    const { sql, params } = bindNamedParams("SELECT * FROM t WHERE a = :MISSING", {});
    assert.equal(sql, "SELECT * FROM t WHERE a = $1");
    assert.deepEqual(params, [null]);
  });

  test("a value containing SQL stays a value and never reaches the statement", () => {
    const evil = "'; DROP TABLE users; --";
    const { sql, params } = bindNamedParams("SELECT * FROM t WHERE a = :A", { A: evil });
    assert.equal(sql, "SELECT * FROM t WHERE a = $1");
    assert.deepEqual(params, [evil]);
    assert.ok(!sql.includes("DROP"), "user value must not be interpolated into SQL text");
  });

  test("leaves ::type casts alone", () => {
    const { sql } = bindNamedParams("SELECT :A::text AS a", { A: "x" });
    assert.equal(sql, "SELECT $1::text AS a");
  });
});

describe("withSessionParams", () => {
  test("supplies the reserved identity parameters", () => {
    const out = withSessionParams({ OTHER: 1 }, scope);
    assert.equal(out.SESSION_COMPANY, "SIHL");
    assert.equal(out.SESSION_HIERARCHY, "0100");
    assert.equal(out.SESSION_USER, "Admin001");
    assert.equal(out.SESSION_USER_UID, 2);
    assert.equal(out.OTHER, 1);
  });

  test("a submitted value cannot spoof the caller's identity", () => {
    const out = withSessionParams({ SESSION_COMPANY: "OTHER_CO", SESSION_USER: "victim" }, scope);
    assert.equal(out.SESSION_COMPANY, "SIHL", "session scope must win over submitted values");
    assert.equal(out.SESSION_USER, "Admin001");
  });
});

describe("wrapWithScope", () => {
  test("appends the predicate and binds the value after existing params", () => {
    const bound = { sql: "SELECT * FROM t WHERE a = $1", params: ["x"] };
    const out = wrapWithScope(bound, "company_code", "SIHL", "w");
    assert.equal(out.sql, "SELECT * FROM (SELECT * FROM t WHERE a = $1) w WHERE w.company_code = $2");
    assert.deepEqual(out.params, ["x", "SIHL"]);
  });

  test("rejects an unsafe column name", () => {
    assert.throws(
      () => wrapWithScope({ sql: "SELECT 1", params: [] }, "x = 1 OR 1", "v", "w"),
      /Unsafe SQL identifier/
    );
  });
});

describe("value resolution", () => {
  test("blank means not-filtered, not empty-string", () => {
    assert.equal(resolveFilterValue("", null), null);
    assert.equal(resolveFilterValue(undefined, null), null);
    assert.equal(resolveFilterValue("", "fallback"), "fallback");
    assert.equal(resolveFilterValue("given", "fallback"), "given");
  });

  test("DATE_RANGE requires both halves to count as present", () => {
    assert.equal(isFilterValuePresent("DATE_RANGE", "2026-01-01,2026-02-01"), true);
    assert.equal(isFilterValuePresent("DATE_RANGE", "2026-01-01,"), false);
    assert.equal(isFilterValuePresent("DATE_RANGE", ","), false);
    assert.equal(isFilterValuePresent("TEXT", "x"), true);
    assert.equal(isFilterValuePresent("TEXT", ""), false);
  });

  test("DATE_RANGE expands into _FROM and _TO parameters", () => {
    const out = buildParamValues(
      [{ componentCode: "D", defaultValue: null, componentType: "DATE_RANGE" }],
      { D: "2026-01-01,2026-02-01" }
    );
    assert.deepEqual(out, { D_FROM: "2026-01-01", D_TO: "2026-02-01" });
  });

  test("an omitted date range binds both halves as null", () => {
    const out = buildParamValues([{ componentCode: "D", defaultValue: null, componentType: "DATE_RANGE" }], {});
    assert.deepEqual(out, { D_FROM: null, D_TO: null });
  });
});
