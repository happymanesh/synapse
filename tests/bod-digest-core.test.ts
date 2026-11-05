import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  groupForDigest,
  isDigestable,
  isOverdue,
  digestKey,
  waitingHours,
  type DigestTicket,
  type DigestRecipient,
} from "../src/lib/bod-digest-core";

const NOW = new Date(2026, 10, 5, 9, 0); // 05-Nov-2026 09:00

function ticket(over: Partial<DigestTicket> = {}): DigestTicket {
  return {
    id: 1,
    ticketNo: "TKT-2026-000001",
    subject: "open position is wrong",
    status: "OPEN",
    ticketType: "ISSUE",
    typeOther: null,
    applicationName: "Trading Terminal",
    segmentName: "Equity Cash",
    raisedAt: new Date(2026, 10, 4, 9, 0),
    slaClockStartAt: new Date(2026, 10, 4, 9, 0), // 24h before NOW
    firstResponseAt: null,
    revisedEta: null,
    mergedIntoTicketId: null,
    assignedToUid: 7,
    ...over,
  };
}

const PRIYA: DigestRecipient = { uid: 7, username: "Priya001", fullName: "Priya Nair", email: "priya@sihl.in" };
const RAVI: DigestRecipient = { uid: 8, username: "Ravi001", fullName: "Ravi Jadhav", email: "ravi@sihl.in" };

describe("isDigestable", () => {
  test("an assigned open ticket qualifies", () => {
    assert.equal(isDigestable(ticket()), true);
  });

  test("every active status qualifies, not just OPEN", () => {
    for (const status of ["OPEN", "IN_PROGRESS", "FORWARDED", "AWAITING_CR_APPROVAL"]) {
      assert.equal(isDigestable(ticket({ status })), true, status);
    }
  });

  test("finished tickets are excluded", () => {
    for (const status of ["RESOLVED", "CLOSED", "MERGED"]) {
      assert.equal(isDigestable(ticket({ status })), false, status);
    }
  });

  test("an unassigned ticket belongs to nobody's digest", () => {
    assert.equal(isDigestable(ticket({ assignedToUid: null })), false);
  });

  test("an absorbed ticket is excluded even while its status looks open", () => {
    // Its work lives on the surviving thread; listing both has two people chasing one problem.
    assert.equal(isDigestable(ticket({ mergedIntoTicketId: 99 })), false);
  });
});

describe("groupForDigest", () => {
  test("groups tickets under their assignee", () => {
    const groups = groupForDigest(
      [ticket({ id: 1, assignedToUid: 7 }), ticket({ id: 2, assignedToUid: 8 }), ticket({ id: 3, assignedToUid: 7 })],
      [PRIYA, RAVI],
      NOW
    );
    assert.equal(groups.length, 2);
    const priya = groups.find((g) => g.recipient.uid === 7)!;
    assert.equal(priya.tickets.length, 2);
  });

  test("somebody with nothing open gets no group at all", () => {
    // Not an empty digest: a daily "you have 0 tickets" trains people to filter the thread,
    // and then the morning it says 9 goes unread with the rest.
    const groups = groupForDigest([ticket({ assignedToUid: 7 })], [PRIYA, RAVI], NOW);
    assert.deepEqual(groups.map((g) => g.recipient.uid), [7]);
  });

  test("returns nothing at all when no tickets qualify", () => {
    assert.deepEqual(groupForDigest([ticket({ status: "CLOSED" })], [PRIYA], NOW), []);
  });

  test("a ticket assigned to someone not in the recipient list is dropped, not reassigned", () => {
    // e.g. the assignee has been deactivated. Quietly handing their work to another desk
    // would be worse than leaving it off the mail.
    assert.deepEqual(groupForDigest([ticket({ assignedToUid: 99 })], [PRIYA], NOW), []);
  });

  test("orders each person's tickets longest-waiting first", () => {
    const old = ticket({ id: 1, slaClockStartAt: new Date(2026, 9, 1) });
    const recent = ticket({ id: 2, slaClockStartAt: new Date(2026, 10, 4) });
    const groups = groupForDigest([recent, old], [PRIYA], NOW);
    assert.deepEqual(groups[0].tickets.map((t) => t.id), [1, 2]);
  });

  test("orders groups by workload, busiest first", () => {
    const groups = groupForDigest(
      [ticket({ id: 1, assignedToUid: 8 }), ticket({ id: 2, assignedToUid: 7 }), ticket({ id: 3, assignedToUid: 7 })],
      [PRIYA, RAVI],
      NOW
    );
    assert.deepEqual(groups.map((g) => g.recipient.uid), [7, 8]);
  });

  test("counts overdue and unanswered per person", () => {
    const answered = ticket({ id: 1, firstResponseAt: new Date(2026, 10, 4, 10, 0) });
    const unanswered = ticket({ id: 2, firstResponseAt: null });
    const groups = groupForDigest([answered, unanswered], [PRIYA], NOW);
    assert.equal(groups[0].unansweredCount, 1);
    assert.equal(groups[0].tickets.length, 2);
  });
});

describe("isOverdue", () => {
  test("a ticket past the response target with no reply is overdue", () => {
    // 25h old against a 24h target, never answered.
    assert.equal(isOverdue(ticket({ slaClockStartAt: new Date(2026, 10, 4, 8, 0) }), NOW), true);
  });

  test("exactly at the target is not yet a breach", () => {
    // The fixture sits at 24h on the dot. hasBreachedResponseTarget uses a strict >, so a
    // ticket is late only once it has actually passed the target, not on reaching it.
    assert.equal(isOverdue(ticket(), NOW), false);
  });

  test("a ticket that was answered is not overdue", () => {
    assert.equal(isOverdue(ticket({ firstResponseAt: new Date(2026, 10, 4, 9, 30) }), NOW), false);
  });

  test("a fresh ticket is not overdue", () => {
    assert.equal(isOverdue(ticket({ slaClockStartAt: new Date(2026, 10, 5, 8, 0) }), NOW), false);
  });
});

describe("digestKey", () => {
  test("is stable for the same day and person", () => {
    assert.equal(digestKey(NOW, 7), digestKey(new Date(2026, 10, 5, 23, 59), 7));
  });

  test("differs per person and per day", () => {
    assert.notEqual(digestKey(NOW, 7), digestKey(NOW, 8));
    assert.notEqual(digestKey(NOW, 7), digestKey(new Date(2026, 10, 6), 7));
  });

  test("reads as a date, so a stuck run is diagnosable by eye", () => {
    assert.equal(digestKey(new Date(2026, 0, 3), 42), "BOD:2026-01-03:42");
  });
});

describe("waitingHours", () => {
  test("whole hours since the turnaround clock started", () => {
    assert.equal(waitingHours(ticket(), NOW), 24);
  });

  test("never negative when the clock is in the future", () => {
    assert.equal(waitingHours(ticket({ slaClockStartAt: new Date(2026, 10, 6) }), NOW), 0);
  });

  test("measures from the clock, not raisedAt, so a merged thread shows the full wait", () => {
    const merged = ticket({ raisedAt: new Date(2026, 10, 5, 8, 0), slaClockStartAt: new Date(2026, 10, 1, 9, 0) });
    assert.equal(waitingHours(merged, NOW), 96);
  });
});
