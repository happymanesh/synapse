import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildCellLink } from "../src/lib/report-link-core";

const ROW = { ticket_id: 42, ticket_no: "TKT-2026-000042", subject: "open position is wrong" };

describe("buildCellLink", () => {
  test("interpolates a column into the path", () => {
    assert.equal(buildCellLink("/support/tickets/{ticket_id}", ROW), "/support/tickets/42");
  });

  test("interpolates several placeholders", () => {
    assert.equal(
      buildCellLink("/a/{ticket_id}/b/{ticket_no}", ROW),
      "/a/42/b/TKT-2026-000042"
    );
  });

  test("a template with no placeholders is used as-is", () => {
    assert.equal(buildCellLink("/support/queue", ROW), "/support/queue");
  });

  test("no template means no link", () => {
    for (const v of ["", null, undefined]) assert.equal(buildCellLink(v, ROW), null);
  });
});

describe("buildCellLink — missing values", () => {
  test("a missing column yields no link rather than a broken one", () => {
    // /support/tickets/ would look clickable and land on a 404.
    assert.equal(buildCellLink("/support/tickets/{nope}", ROW), null);
  });

  test("null, undefined and empty-string values all suppress the link", () => {
    for (const value of [null, undefined, ""]) {
      assert.equal(buildCellLink("/t/{id}", { id: value }), null, String(value));
    }
  });

  test("zero is a real value, not a missing one", () => {
    assert.equal(buildCellLink("/t/{id}", { id: 0 }), "/t/0");
  });

  test("false is a real value too", () => {
    assert.equal(buildCellLink("/t/{flag}", { flag: false }), "/t/false");
  });
});

describe("buildCellLink — safety", () => {
  test("refuses a javascript: template", () => {
    assert.equal(buildCellLink("javascript:alert(1)", ROW), null);
  });

  test("refuses a data: template", () => {
    assert.equal(buildCellLink("data:text/html,<script>alert(1)</script>", ROW), null);
  });

  test("refuses an absolute link to another site", () => {
    assert.equal(buildCellLink("https://evil.example/steal", ROW), null);
  });

  test("refuses a protocol-relative URL", () => {
    // Starts with a slash but browsers resolve //host as an external origin.
    assert.equal(buildCellLink("//evil.example/steal", ROW), null);
  });

  test("refuses a relative path that is not rooted", () => {
    assert.equal(buildCellLink("support/tickets/{ticket_id}", ROW), null);
  });

  test("a value cannot break out of its path segment", () => {
    const href = buildCellLink("/support/tickets/{ticket_id}", { ticket_id: "1/../../admin" });
    assert.equal(href, "/support/tickets/1%2F..%2F..%2Fadmin");
  });

  test("a value cannot inject a query or fragment", () => {
    const href = buildCellLink("/t/{id}", { id: "1?next=x#y" });
    assert.ok(href !== null && !href.includes("?") && !href.includes("#"));
  });

  test("a value containing a quote cannot escape the attribute", () => {
    const href = buildCellLink("/t/{id}", { id: '1"><img src=x onerror=alert(1)>' });
    assert.ok(href !== null && !href.includes('"') && !href.includes("<"));
  });
});
