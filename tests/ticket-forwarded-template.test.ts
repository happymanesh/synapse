import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ticketForwardedEmail, istTimestamp } from "../src/lib/mail/ticket-forwarded.template";

const BASE = {
  recipientName: "Priya",
  ticketNo: "TKT-2026-000042",
  subject: "Holdings page showing stale prices",
  ticketType: "Bug",
  application: "Trading Terminal",
  segment: "Equity Cash",
  raisedBy: "Ranjeeta Mukherjee (C1001)",
  raisedAt: new Date("2026-09-16T09:15:00+05:30"),
  clockStartedAt: new Date("2026-09-16T09:15:00+05:30"),
  forwardedBy: "Manesh001",
  reason: "Needs the RMS team — stale quotes are arriving on the feed itself.",
  ticketUrl: "https://synapse.example.com/support/tickets/42",
  when: new Date("2026-09-16T15:15:00+05:30"),
  responseTargetHours: 24,
  productName: "SIHL Synapse",
};

describe("istTimestamp", () => {
  test("renders IST regardless of the server's own timezone", () => {
    // Pinned, not inherited: the stamp must be right even if the container is on UTC.
    assert.equal(istTimestamp(new Date("2026-09-16T09:15:00+05:30")), "16-Sep-2026 09:15");
    assert.equal(istTimestamp(new Date("2026-09-16T03:45:00Z")), "16-Sep-2026 09:15");
  });

  test("uses a four-digit year, unlike the app's dd-Mmm-yy tables", () => {
    assert.match(istTimestamp(BASE.raisedAt), /-2026 /);
  });

  test("pads single-digit days and hours", () => {
    assert.equal(istTimestamp(new Date("2026-01-03T04:05:00+05:30")), "03-Jan-2026 04:05");
  });
});

describe("subject line", () => {
  test("leads with the ticket number so replies and searches find the thread", () => {
    const r = ticketForwardedEmail(BASE);
    assert.ok(r.subject.startsWith("[TKT-2026-000042]"));
  });

  test("carries the raiser's own words, so the desk can triage from the inbox list", () => {
    assert.ok(ticketForwardedEmail(BASE).subject.includes("Holdings page showing stale prices"));
  });
});

describe("body content", () => {
  test("states who forwarded it and why — §4.5 makes the reason mandatory", () => {
    const r = ticketForwardedEmail(BASE);
    for (const body of [r.text, r.html]) {
      assert.ok(body.includes("Manesh001"), "forwarder");
      assert.ok(body.includes("stale quotes are arriving on the feed itself"), "reason");
    }
  });

  test("carries all three classification axes", () => {
    const r = ticketForwardedEmail(BASE);
    for (const body of [r.text, r.html]) {
      assert.ok(body.includes("Bug"));
      assert.ok(body.includes("Trading Terminal"));
      assert.ok(body.includes("Equity Cash"));
    }
  });

  test("includes a link to the ticket", () => {
    const r = ticketForwardedEmail(BASE);
    assert.ok(r.text.includes(BASE.ticketUrl));
    assert.ok(r.html.includes(BASE.ticketUrl));
  });

  test("ships both a plain-text and an HTML body", () => {
    const r = ticketForwardedEmail(BASE);
    assert.ok(r.text.length > 200);
    assert.ok(r.html.startsWith("<!doctype html>"));
  });
});

describe("waiting time", () => {
  test("inside the target, states the target rather than alarming", () => {
    const r = ticketForwardedEmail(BASE); // 6 hours elapsed
    assert.ok(r.text.includes("Waiting: 6 hours (response target is 24 hours)"));
    assert.ok(!r.text.includes("past the"));
  });

  test("past the target, says so — a forwarded ticket is often already late", () => {
    const late = { ...BASE, when: new Date("2026-09-17T11:15:00+05:30") }; // 26 hours
    const r = ticketForwardedEmail(late);
    assert.ok(r.text.includes("past the 24-hour response target"));
    assert.ok(r.html.includes("Past the response target"));
  });

  test("measures from the turnaround clock, not raisedAt", () => {
    // After a merge the clock predates raisedAt, and the email should show the full wait.
    const merged = { ...BASE, clockStartedAt: new Date("2026-09-15T09:15:00+05:30") };
    assert.ok(ticketForwardedEmail(merged).text.includes("Waiting: 30 hours"));
  });

  test("never reports negative time if the clocks disagree", () => {
    const odd = { ...BASE, clockStartedAt: new Date("2026-09-17T09:15:00+05:30") };
    assert.ok(ticketForwardedEmail(odd).text.includes("Waiting: 0 hours"));
  });

  test("singular hour reads correctly in the HTML", () => {
    const oneHour = { ...BASE, when: new Date("2026-09-16T10:20:00+05:30") };
    assert.ok(ticketForwardedEmail(oneHour).html.includes("Waiting 1 hour "));
  });
});

describe("HTML escaping", () => {
  test("escapes a subject containing markup — subjects are raiser input", () => {
    const nasty = { ...BASE, subject: '<img src=x onerror="alert(1)">' };
    const r = ticketForwardedEmail(nasty);
    assert.ok(!r.html.includes("<img src=x"), "raw tag must not survive");
    assert.ok(r.html.includes("&lt;img src=x"));
  });

  test("escapes the forward reason, which staff type freely", () => {
    const nasty = { ...BASE, reason: "see <script>alert(1)</script>" };
    assert.ok(!ticketForwardedEmail(nasty).html.includes("<script>"));
  });

  test("escapes names and quotes", () => {
    const nasty = { ...BASE, raisedBy: 'O\'Brien & "Co" <ops>' };
    const html = ticketForwardedEmail(nasty).html;
    assert.ok(html.includes("&amp;"));
    assert.ok(!html.includes("<ops>"));
  });

  test("the plain-text body is left unescaped — it is not markup", () => {
    const nasty = { ...BASE, subject: "A & B" };
    assert.ok(ticketForwardedEmail(nasty).text.includes("A & B"));
  });
});

describe("type rendering", () => {
  test("an OTHERS ticket shows the mentioned text, which is the only thing that makes it useful", () => {
    const other = { ...BASE, ticketType: "Others — Data correction" };
    assert.ok(ticketForwardedEmail(other).text.includes("Others — Data correction"));
  });
});
