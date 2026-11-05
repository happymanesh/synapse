import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { bodDigestEmail, formatWait, type DigestRow } from "../src/lib/mail/bod-digest.template";

function row(over: Partial<DigestRow> = {}): DigestRow {
  return {
    ticketNo: "TKT-2026-000042",
    subject: "Holdings page showing stale prices",
    ticketType: "Bug",
    application: "Trading Terminal",
    raisedAt: new Date(2026, 10, 4, 9, 15),
    waitingHours: 26,
    overdue: true,
    url: "https://synapse.sihl.in/support/tickets/42",
    ...over,
  };
}

const BASE = {
  recipientName: "Priya",
  rows: [row()],
  overdueCount: 1,
  unansweredCount: 1,
  queueUrl: "https://synapse.sihl.in/support/queue",
  when: new Date("2026-11-05T09:00:00+05:30"),
  responseTargetHours: 24,
  productName: "SIHL Synapse",
};

describe("formatWait", () => {
  test("renders hours, days and the sub-hour case", () => {
    assert.equal(formatWait(0), "under an hour");
    assert.equal(formatWait(5), "5h");
    assert.equal(formatWait(24), "1d");
    assert.equal(formatWait(26), "1d 2h");
    assert.equal(formatWait(72), "3d");
  });
});

describe("subject", () => {
  test("leads with the count, so a phone preview is enough", () => {
    assert.ok(bodDigestEmail(BASE).subject.startsWith("1 open ticket with you"));
  });

  test("calls out overdue in the subject", () => {
    assert.ok(bodDigestEmail(BASE).subject.includes("1 past target"));
  });

  test("says nothing about overdue when nothing is late", () => {
    const clean = { ...BASE, rows: [row({ overdue: false })], overdueCount: 0 };
    assert.equal(bodDigestEmail(clean).subject, "1 open ticket with you");
  });

  test("pluralises", () => {
    const many = { ...BASE, rows: [row(), row({ ticketNo: "TKT-2026-000043" })], overdueCount: 0 };
    assert.ok(bodDigestEmail(many).subject.startsWith("2 open tickets with you"));
  });
});

describe("body", () => {
  test("ships both a plain-text and an HTML part", () => {
    const r = bodDigestEmail(BASE);
    assert.ok(r.text.length > 150);
    assert.ok(r.html.startsWith("<!doctype html>"));
  });

  test("lists every ticket in both parts", () => {
    const two = { ...BASE, rows: [row(), row({ ticketNo: "TKT-2026-000043", subject: "Ledger mismatch" })] };
    const r = bodDigestEmail(two);
    for (const body of [r.text, r.html]) {
      assert.ok(body.includes("TKT-2026-000042"), "first");
      assert.ok(body.includes("TKT-2026-000043"), "second");
      assert.ok(body.includes("Ledger mismatch"), "subject");
    }
  });

  test("each ticket number links to its ticket in the HTML", () => {
    assert.ok(bodDigestEmail(BASE).html.includes('href="https://synapse.sihl.in/support/tickets/42"'));
  });

  test("links to the triage queue", () => {
    const r = bodDigestEmail(BASE);
    assert.ok(r.text.includes(BASE.queueUrl));
    assert.ok(r.html.includes(BASE.queueUrl));
  });

  test("states the overdue count against the target", () => {
    assert.ok(bodDigestEmail(BASE).text.includes("past the 24-hour response target"));
  });

  test("says so plainly when nothing is late", () => {
    const clean = { ...BASE, rows: [row({ overdue: false })], overdueCount: 0, unansweredCount: 0 };
    assert.ok(bodDigestEmail(clean).text.includes("None are past the 24-hour response target"));
  });

  test("marks the late rows", () => {
    const r = bodDigestEmail(BASE);
    assert.ok(r.text.includes("LATE"));
    assert.ok(r.html.includes("late"));
  });
});

describe("escaping", () => {
  test("escapes a subject containing markup — subjects are raiser input", () => {
    const nasty = { ...BASE, rows: [row({ subject: '<img src=x onerror="alert(1)">' })] };
    const html = bodDigestEmail(nasty).html;
    assert.ok(!html.includes("<img src=x"));
    assert.ok(html.includes("&lt;img src=x"));
  });

  test("escapes the recipient name and the application", () => {
    const nasty = { ...BASE, recipientName: 'O\'Brien & "Co"', rows: [row({ application: "<b>RMS</b>" })] };
    const html = bodDigestEmail(nasty).html;
    assert.ok(html.includes("&amp;"));
    assert.ok(!html.includes("<b>RMS</b>"));
  });

  test("the plain-text part is left unescaped — it is not markup", () => {
    const amp = { ...BASE, rows: [row({ subject: "A & B" })] };
    assert.ok(bodDigestEmail(amp).text.includes("A & B"));
  });
});
