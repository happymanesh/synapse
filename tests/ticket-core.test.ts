import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  resolveRaiser,
  raiserTypeForHierarchy,
  normalizeMobile,
  normalizeEmail,
  isSameEntity,
  isLikelyDuplicate,
  findDuplicateCandidates,
  isOpenStatus,
  mergedClockStart,
  turnaroundMs,
  averageTurnaroundMs,
  hasBreachedResponseTarget,
  canReconcile,
  requiresTypeOther,
  describeTicketType,
  TICKET_TYPES,
  canProposeChangeRequest,
  canDecideChangeRequest,
  ticketStatusAfterDecision,
  canTransition,
  allowedTransitions,
  timestampsForTransition,
  TICKET_STATUSES,
  DUPLICATE_WINDOW_HOURS,
  type MasterUserRow,
  type TicketLike,
} from "../src/lib/ticket-core";

/** A master-data row with defaults, so each test states only what it cares about. */
function user(over: Partial<MasterUserRow> & { uid: number }): MasterUserRow {
  return {
    hierarchyCode: "0200",
    email: null,
    mobile: null,
    isActive: true,
    ...over,
  };
}

/** A ticket with defaults. Base time is deliberately mid-day so ±hours stays in one day. */
const BASE = new Date("2026-08-05T12:00:00Z");
function at(hoursFromBase: number): Date {
  return new Date(BASE.getTime() + hoursFromBase * 60 * 60 * 1000);
}
function ticket(over: Partial<TicketLike> & { id: number }): TicketLike {
  return {
    applicationId: 1,
    ticketType: "BUG",
    status: "OPEN",
    raisedAt: BASE,
    raiserUid: null,
    clientCode: null,
    guestEmail: null,
    guestMobile: null,
    mergedIntoTicketId: null,
    ...over,
  };
}

describe("normalizeMobile", () => {
  test("matches the same number written as E.164, spaced, or plain", () => {
    // WhatsApp delivers E.164; humans type spaces; master data stores 10 digits.
    assert.equal(normalizeMobile("919892953949"), "9892953949");
    assert.equal(normalizeMobile("+91 98929 53949"), "9892953949");
    assert.equal(normalizeMobile("9892953949"), "9892953949");
  });

  test("anything shorter than a subscriber number is treated as no contact", () => {
    // A shortcode or truncated entry is too weak to identify a person.
    assert.equal(normalizeMobile("12345"), null);
    assert.equal(normalizeMobile("+91"), null);
  });

  test("blank and null are no contact", () => {
    assert.equal(normalizeMobile(null), null);
    assert.equal(normalizeMobile(""), null);
    assert.equal(normalizeMobile("   "), null);
  });
});

describe("normalizeEmail", () => {
  test("is case and whitespace insensitive", () => {
    assert.equal(normalizeEmail("  Happy.Manesh@Example.COM "), "happy.manesh@example.com");
  });

  test("blank and null are no contact", () => {
    assert.equal(normalizeEmail(null), null);
    assert.equal(normalizeEmail("   "), null);
  });
});

describe("raiserTypeForHierarchy", () => {
  test("0800 Client and 0700 Family are both CLIENT", () => {
    assert.equal(raiserTypeForHierarchy("0800"), "CLIENT");
    assert.equal(raiserTypeForHierarchy("0700"), "CLIENT");
  });

  test("Franchisee, SubBroker and Remisier are PARTNER", () => {
    for (const h of ["0400", "0500", "0600"]) {
      assert.equal(raiserTypeForHierarchy(h), "PARTNER", `hierarchy ${h}`);
    }
  });

  test("internal tiers are EMPLOYEE", () => {
    for (const h of ["0000", "0100", "0200", "0300", "9999"]) {
      assert.equal(raiserTypeForHierarchy(h), "EMPLOYEE", `hierarchy ${h}`);
    }
  });
});

describe("resolveRaiser", () => {
  const staff = user({ uid: 1, hierarchyCode: "0200", email: "staff@sihl.in", mobile: "9800000001" });
  const client = user({ uid: 2, hierarchyCode: "0800", email: "client@example.com", mobile: "9800000002" });
  const partner = user({ uid: 3, hierarchyCode: "0500", email: "sub@broker.in", mobile: "9800000003" });
  const all = [staff, client, partner];

  test("matches an employee by email", () => {
    const r = resolveRaiser({ email: "staff@sihl.in" }, all);
    assert.deepEqual(r, { raiserUid: 1, raiserType: "EMPLOYEE", matchedOn: "EMAIL", ambiguous: false });
  });

  test("matches a client by email and types them CLIENT", () => {
    const r = resolveRaiser({ email: "client@example.com" }, all);
    assert.equal(r.raiserUid, 2);
    assert.equal(r.raiserType, "CLIENT");
  });

  test("matches a sub-broker by mobile and types them PARTNER", () => {
    const r = resolveRaiser({ mobile: "+91 98000 00003" }, all);
    assert.equal(r.raiserUid, 3);
    assert.equal(r.raiserType, "PARTNER");
    assert.equal(r.matchedOn, "MOBILE");
  });

  test("matches a WhatsApp sender arriving in E.164", () => {
    const r = resolveRaiser({ mobile: "919800000002" }, all);
    assert.equal(r.raiserUid, 2);
  });

  test("an unknown contact becomes a GUEST rather than an error — §5 forbids hard-blocking", () => {
    const r = resolveRaiser({ email: "prospect@nowhere.com", mobile: "9700000000" }, all);
    assert.deepEqual(r, { raiserUid: null, raiserType: "GUEST", matchedOn: null, ambiguous: false });
  });

  test("no contact details at all still resolves, as a GUEST", () => {
    assert.equal(resolveRaiser({}, all).raiserType, "GUEST");
    assert.equal(resolveRaiser({ email: null, mobile: null }, all).raiserType, "GUEST");
  });

  test("an empty master-data set does not throw", () => {
    assert.equal(resolveRaiser({ email: "anyone@example.com" }, []).raiserType, "GUEST");
  });

  test("email wins over mobile when the two point at different people", () => {
    // A shared handset is common; a shared mailbox on two master records is not.
    const r = resolveRaiser({ email: "client@example.com", mobile: "9800000001" }, all);
    assert.equal(r.raiserUid, 2);
    assert.equal(r.matchedOn, "EMAIL");
  });

  test("falls through to mobile when the email is unknown", () => {
    const r = resolveRaiser({ email: "unknown@example.com", mobile: "9800000001" }, all);
    assert.equal(r.raiserUid, 1);
    assert.equal(r.matchedOn, "MOBILE");
  });

  test("a mobile shared by two family accounts resolves to GUEST, flagged ambiguous", () => {
    // Attributing a complaint to the wrong family member is worse than asking a human.
    const shared = [
      user({ uid: 10, hierarchyCode: "0800", mobile: "9811111111" }),
      user({ uid: 11, hierarchyCode: "0700", mobile: "9811111111" }),
    ];
    const r = resolveRaiser({ mobile: "9811111111" }, shared);
    assert.equal(r.raiserUid, null);
    assert.equal(r.raiserType, "GUEST");
    assert.equal(r.ambiguous, true);
  });

  test("an ambiguous email does not silently fall through to a mobile match", () => {
    // Falling through would resolve to someone the ambiguous email might not belong to.
    const rows = [
      user({ uid: 20, email: "shared@example.com" }),
      user({ uid: 21, email: "shared@example.com" }),
      user({ uid: 22, mobile: "9822222222" }),
    ];
    const r = resolveRaiser({ email: "shared@example.com", mobile: "9822222222" }, rows);
    assert.equal(r.raiserUid, null);
    assert.equal(r.ambiguous, true);
  });

  test("a deactivated user still matches — isActive governs login, not who someone is", () => {
    const former = [user({ uid: 30, hierarchyCode: "0800", email: "former@example.com", isActive: false })];
    const r = resolveRaiser({ email: "former@example.com" }, former);
    assert.equal(r.raiserUid, 30);
    assert.equal(r.raiserType, "CLIENT");
  });

  test("master rows with no contact details never match a blank contact", () => {
    const blanks = [user({ uid: 40, email: null, mobile: null })];
    assert.equal(resolveRaiser({ email: null, mobile: null }, blanks).raiserUid, null);
  });
});

describe("ticket type", () => {
  test("the six types are fixed, so a report dimension cannot drift", () => {
    assert.deepEqual([...TICKET_TYPES], ["ISSUE", "COMPLAINT", "BUG", "REQUEST", "CLARIFICATION", "OTHERS"]);
  });

  test("only OTHERS needs the mention text", () => {
    assert.equal(requiresTypeOther("OTHERS"), true);
    for (const t of ["ISSUE", "COMPLAINT", "BUG", "REQUEST", "CLARIFICATION"]) {
      assert.equal(requiresTypeOther(t), false, t);
    }
  });

  test("a known type renders as its label", () => {
    assert.equal(describeTicketType("CLARIFICATION", null), "Clarification");
    assert.equal(describeTicketType("BUG", "ignored"), "Bug");
  });

  test("OTHERS renders the mentioned text, which is the only thing that makes it useful", () => {
    assert.equal(describeTicketType("OTHERS", "Data correction"), "Others — Data correction");
  });

  test("OTHERS with no mention still renders rather than showing a blank", () => {
    assert.equal(describeTicketType("OTHERS", null), "Others");
    assert.equal(describeTicketType("OTHERS", "   "), "Others");
  });

  test("an unknown type falls back to itself rather than undefined", () => {
    assert.equal(describeTicketType("LEGACY_THING", null), "LEGACY_THING");
  });
});

describe("duplicate matching uses BOTH classification axes", () => {
  const a = ticket({ id: 1, raiserUid: 7, applicationId: 3, ticketType: "BUG" });

  test("same application but a different type is not a duplicate", () => {
    // A bug and a billing query about the same system are not the same issue.
    assert.equal(isLikelyDuplicate(a, ticket({ id: 2, raiserUid: 7, applicationId: 3, ticketType: "COMPLAINT" })), false);
  });

  test("same type but a different application is not a duplicate", () => {
    assert.equal(isLikelyDuplicate(a, ticket({ id: 2, raiserUid: 7, applicationId: 4, ticketType: "BUG" })), false);
  });

  test("both axes matching, same entity, in window, is a duplicate", () => {
    assert.equal(isLikelyDuplicate(a, ticket({ id: 2, raiserUid: 7, applicationId: 3, ticketType: "BUG" })), true);
  });
});

describe("canReconcile", () => {
  test("a guest ticket can be linked to a master record", () => {
    assert.equal(canReconcile({ raiserUid: null, mergedIntoTicketId: null }), true);
  });

  test("an already-attributed ticket cannot be re-pointed at someone else", () => {
    // Rewriting who raised a ticket is exactly what the audit trail exists to prevent.
    assert.equal(canReconcile({ raiserUid: 7, mergedIntoTicketId: null }), false);
  });

  test("an absorbed ticket cannot be reconciled — fix the surviving thread instead", () => {
    assert.equal(canReconcile({ raiserUid: null, mergedIntoTicketId: 9 }), false);
  });
});

describe("isOpenStatus", () => {
  test("work-in-progress statuses are open", () => {
    for (const s of ["OPEN", "IN_PROGRESS", "FORWARDED", "AWAITING_CR_APPROVAL"]) {
      assert.equal(isOpenStatus(s), true, s);
    }
  });

  test("finished and absorbed statuses are not", () => {
    for (const s of ["RESOLVED", "CLOSED", "MERGED"]) {
      assert.equal(isOpenStatus(s), false, s);
    }
  });
});

describe("isSameEntity", () => {
  test("two resolved tickets match on uid", () => {
    assert.equal(isSameEntity(ticket({ id: 1, raiserUid: 7 }), ticket({ id: 2, raiserUid: 7 })), true);
    assert.equal(isSameEntity(ticket({ id: 1, raiserUid: 7 }), ticket({ id: 2, raiserUid: 8 })), false);
  });

  test("falls back to client code when neither is resolved", () => {
    assert.equal(isSameEntity(ticket({ id: 1, clientCode: "C123" }), ticket({ id: 2, clientCode: "C123" })), true);
    assert.equal(isSameEntity(ticket({ id: 1, clientCode: "C123" }), ticket({ id: 2, clientCode: "C999" })), false);
  });

  test("guest tickets match on email or on mobile in any format", () => {
    assert.equal(
      isSameEntity(ticket({ id: 1, guestEmail: "A@x.com" }), ticket({ id: 2, guestEmail: "a@x.com" })),
      true
    );
    assert.equal(
      isSameEntity(ticket({ id: 1, guestMobile: "+91 98000 00009" }), ticket({ id: 2, guestMobile: "919800000009" })),
      true
    );
  });

  test("two anonymous guests with no identifying detail are NOT the same entity", () => {
    // Otherwise every anonymous ticket in a category would look like a duplicate of every
    // other one, and staff would be offered nonsense merges.
    assert.equal(isSameEntity(ticket({ id: 1 }), ticket({ id: 2 })), false);
  });

  test("a resolved ticket and a guest ticket do not match on absent keys", () => {
    assert.equal(isSameEntity(ticket({ id: 1, raiserUid: 7 }), ticket({ id: 2, guestEmail: null })), false);
  });
});

describe("isLikelyDuplicate", () => {
  const a = ticket({ id: 1, raiserUid: 7, raisedAt: BASE });

  test("same category, same entity, both open, inside the window", () => {
    const b = ticket({ id: 2, raiserUid: 7, raisedAt: at(-5) });
    assert.equal(isLikelyDuplicate(a, b), true);
  });

  test("a different application is never a duplicate", () => {
    const b = ticket({ id: 2, raiserUid: 7, applicationId: 9, raisedAt: at(-5) });
    assert.equal(isLikelyDuplicate(a, b), false);
  });

  test("a different entity is never a duplicate", () => {
    assert.equal(isLikelyDuplicate(a, ticket({ id: 2, raiserUid: 8, raisedAt: at(-5) })), false);
  });

  test("outside the rolling window is not a duplicate", () => {
    assert.equal(isLikelyDuplicate(a, ticket({ id: 2, raiserUid: 7, raisedAt: at(-49) })), false);
  });

  test("exactly at the window boundary still counts", () => {
    assert.equal(isLikelyDuplicate(a, ticket({ id: 2, raiserUid: 7, raisedAt: at(-DUPLICATE_WINDOW_HOURS) })), true);
  });

  test("the window is symmetric — order of the pair does not matter", () => {
    const older = ticket({ id: 2, raiserUid: 7, raisedAt: at(-10) });
    assert.equal(isLikelyDuplicate(a, older), isLikelyDuplicate(older, a));
  });

  test("a narrower window can be requested", () => {
    const b = ticket({ id: 2, raiserUid: 7, raisedAt: at(-30) });
    assert.equal(isLikelyDuplicate(a, b, 48), true);
    assert.equal(isLikelyDuplicate(a, b, 24), false);
  });

  test("a resolved or closed ticket is never offered", () => {
    for (const status of ["RESOLVED", "CLOSED"]) {
      assert.equal(isLikelyDuplicate(a, ticket({ id: 2, raiserUid: 7, status, raisedAt: at(-1) })), false, status);
    }
  });

  test("an already-absorbed ticket is never offered again", () => {
    // Merging into it would strand history behind two hops.
    const absorbed = ticket({ id: 2, raiserUid: 7, raisedAt: at(-1), mergedIntoTicketId: 99 });
    assert.equal(isLikelyDuplicate(a, absorbed), false);
  });

  test("a ticket is not a duplicate of itself", () => {
    assert.equal(isLikelyDuplicate(a, { ...a }), false);
  });
});

describe("findDuplicateCandidates", () => {
  const target = ticket({ id: 1, raiserUid: 7, raisedAt: BASE });

  test("returns only genuine candidates, newest first", () => {
    const found = findDuplicateCandidates(target, [
      ticket({ id: 2, raiserUid: 7, raisedAt: at(-20) }),
      ticket({ id: 3, raiserUid: 8, raisedAt: at(-1) }), // different entity
      ticket({ id: 4, raiserUid: 7, raisedAt: at(-2) }),
      ticket({ id: 5, raiserUid: 7, raisedAt: at(-100) }), // outside window
      ticket({ id: 6, raiserUid: 7, status: "CLOSED", raisedAt: at(-3) }),
    ]);
    assert.deepEqual(found.map((t) => t.id), [4, 2]);
  });

  test("no candidates yields an empty list, not a throw", () => {
    assert.deepEqual(findDuplicateCandidates(target, []), []);
  });
});

describe("mergedClockStart", () => {
  test("the earlier clock wins, whichever side it is on", () => {
    const survivor = { raisedAt: at(0), slaClockStartAt: at(0) };
    const earlier = { raisedAt: at(-10), slaClockStartAt: at(-10) };
    assert.equal(mergedClockStart(survivor, earlier).getTime(), at(-10).getTime());
    assert.equal(mergedClockStart(earlier, survivor).getTime(), at(-10).getTime());
  });

  test("equal clocks are unchanged", () => {
    const t = { raisedAt: at(0), slaClockStartAt: at(0) };
    assert.equal(mergedClockStart(t, { ...t }).getTime(), at(0).getTime());
  });

  test("a chained merge keeps the earliest clock, not the survivor's raisedAt", () => {
    // The load-bearing case. Survivor was raised at 0 but already absorbed a ticket from
    // -20, so its clock is -20. Absorbing another from -5 must NOT move the clock forward.
    // Comparing raisedAt instead of slaClockStartAt would reset it to 0 and understate
    // elapsed time — exactly what the §4.4 rule exists to prevent.
    const survivorAfterFirstMerge = { raisedAt: at(0), slaClockStartAt: at(-20) };
    const second = { raisedAt: at(-5), slaClockStartAt: at(-5) };
    assert.equal(mergedClockStart(survivorAfterFirstMerge, second).getTime(), at(-20).getTime());
  });
});

describe("turnaroundMs", () => {
  const HOUR = 60 * 60 * 1000;

  test("measures from the clock start to resolution", () => {
    const t = { slaClockStartAt: at(-6), resolvedAt: at(-2), mergedIntoTicketId: null };
    assert.equal(turnaroundMs(t), 4 * HOUR);
  });

  test("an unresolved ticket measures to now", () => {
    const t = { slaClockStartAt: at(-3), resolvedAt: null, mergedIntoTicketId: null };
    assert.equal(turnaroundMs(t, BASE), 3 * HOUR);
  });

  test("uses the merged clock, so a merged thread reports the full elapsed time", () => {
    const merged = { slaClockStartAt: at(-30), resolvedAt: at(0), mergedIntoTicketId: null };
    assert.equal(turnaroundMs(merged), 30 * HOUR);
  });

  test("never reports negative time when timestamps are out of order", () => {
    const odd = { slaClockStartAt: at(0), resolvedAt: at(-5), mergedIntoTicketId: null };
    assert.equal(turnaroundMs(odd), 0);
  });
});

describe("averageTurnaroundMs", () => {
  const HOUR = 60 * 60 * 1000;

  test("averages resolved tickets", () => {
    const avg = averageTurnaroundMs([
      { slaClockStartAt: at(-4), resolvedAt: at(0), mergedIntoTicketId: null },
      { slaClockStartAt: at(-8), resolvedAt: at(0), mergedIntoTicketId: null },
    ]);
    assert.equal(avg, 6 * HOUR);
  });

  test("excludes absorbed tickets so a merged pair counts once", () => {
    // The absorbed row keeps its own short clock; counting it would double-count one issue
    // and drag the average down.
    const avg = averageTurnaroundMs([
      { slaClockStartAt: at(-10), resolvedAt: at(0), mergedIntoTicketId: null },
      { slaClockStartAt: at(-1), resolvedAt: at(0), mergedIntoTicketId: 1 },
    ]);
    assert.equal(avg, 10 * HOUR);
  });

  test("excludes tickets that are still open", () => {
    const avg = averageTurnaroundMs([
      { slaClockStartAt: at(-4), resolvedAt: at(0), mergedIntoTicketId: null },
      { slaClockStartAt: at(-100), resolvedAt: null, mergedIntoTicketId: null },
    ]);
    assert.equal(avg, 4 * HOUR);
  });

  test("returns null when nothing qualifies, so a report can say 'no data' rather than '0'", () => {
    assert.equal(averageTurnaroundMs([]), null);
    assert.equal(averageTurnaroundMs([{ slaClockStartAt: at(-4), resolvedAt: null, mergedIntoTicketId: null }]), null);
  });
});

describe("canTransition", () => {
  test("an open ticket can be worked, forwarded, resolved or closed", () => {
    for (const to of ["IN_PROGRESS", "FORWARDED", "AWAITING_CR_APPROVAL", "RESOLVED", "CLOSED"]) {
      assert.equal(canTransition("OPEN", to), true, to);
    }
  });

  test("a resolved or closed ticket can be reopened", () => {
    // A client replying "that didn't fix it" is ordinary; forcing a second ticket would
    // restart the clock and hide the real elapsed time.
    assert.equal(canTransition("RESOLVED", "OPEN"), true);
    assert.equal(canTransition("CLOSED", "OPEN"), true);
  });

  test("MERGED is terminal — an absorbed ticket can never move again", () => {
    // Its history lives on the surviving thread now; reopening would fork the trail.
    for (const to of TICKET_STATUSES) {
      assert.equal(canTransition("MERGED", to), false, to);
    }
    assert.deepEqual(allowedTransitions("MERGED"), []);
  });

  test("nothing can be moved to MERGED by a status change", () => {
    // Only the merge service sets it, because it must also write the link and both events.
    for (const from of TICKET_STATUSES) {
      assert.equal(canTransition(from, "MERGED"), false, from);
    }
  });

  test("a closed ticket cannot jump straight back to resolved", () => {
    assert.equal(canTransition("CLOSED", "RESOLVED"), false);
  });

  test("an unknown status has no transitions rather than throwing", () => {
    assert.equal(canTransition("NONSENSE", "OPEN"), false);
    assert.deepEqual(allowedTransitions("NONSENSE"), []);
  });
});

describe("timestampsForTransition", () => {
  const none = { resolvedAt: null, closedAt: null };

  test("resolving stamps resolvedAt", () => {
    const t = timestampsForTransition("RESOLVED", BASE, none);
    assert.equal(t.resolvedAt?.getTime(), BASE.getTime());
    assert.equal(t.closedAt, null);
  });

  test("closing an already-resolved ticket keeps the original resolution time", () => {
    const t = timestampsForTransition("CLOSED", BASE, { resolvedAt: at(-5), closedAt: null });
    assert.equal(t.resolvedAt?.getTime(), at(-5).getTime());
    assert.equal(t.closedAt?.getTime(), BASE.getTime());
  });

  test("closing a never-resolved ticket still stamps resolvedAt", () => {
    // Otherwise closing outright would drop the ticket from the §4.8 average entirely,
    // making "just close it" the cheapest way to keep the average looking good.
    const t = timestampsForTransition("CLOSED", BASE, none);
    assert.equal(t.resolvedAt?.getTime(), BASE.getTime());
    assert.equal(t.closedAt?.getTime(), BASE.getTime());
  });

  test("reopening clears both, so no stale resolution time survives", () => {
    const resolved = { resolvedAt: at(-2), closedAt: at(-1) };
    for (const to of ["OPEN", "IN_PROGRESS", "FORWARDED"]) {
      assert.deepEqual(timestampsForTransition(to, BASE, resolved), none, to);
    }
  });

  test("a reopened ticket then re-counts from its original clock, not from reopening", () => {
    // turnaroundMs measures from slaClockStartAt, which a reopen never touches.
    const reopened = timestampsForTransition("OPEN", BASE, { resolvedAt: at(-2), closedAt: null });
    assert.equal(
      turnaroundMs({ slaClockStartAt: at(-10), resolvedAt: reopened.resolvedAt, mergedIntoTicketId: null }, BASE),
      10 * 60 * 60 * 1000
    );
  });
});

describe("canProposeChangeRequest", () => {
  const base = { status: "OPEN", mergedIntoTicketId: null, hasChangeRequest: false };

  test("an open ticket with no change request can be proposed", () => {
    for (const status of ["OPEN", "IN_PROGRESS", "FORWARDED"]) {
      assert.equal(canProposeChangeRequest({ ...base, status }), true, status);
    }
  });

  test("a ticket already awaiting a decision cannot be proposed again", () => {
    // Two pending items for the same ticket would leave management reconciling duplicates.
    assert.equal(canProposeChangeRequest({ ...base, status: "AWAITING_CR_APPROVAL" }), false);
  });

  test("a ticket that already has a change request cannot get a second", () => {
    assert.equal(canProposeChangeRequest({ ...base, hasChangeRequest: true }), false);
  });

  test("resolved, closed and absorbed tickets cannot be proposed", () => {
    assert.equal(canProposeChangeRequest({ ...base, status: "RESOLVED" }), false);
    assert.equal(canProposeChangeRequest({ ...base, status: "CLOSED" }), false);
    assert.equal(canProposeChangeRequest({ ...base, mergedIntoTicketId: 3 }), false);
  });
});

describe("canDecideChangeRequest", () => {
  test("only a pending request can be decided", () => {
    assert.equal(canDecideChangeRequest({ approvalStatus: "PENDING" }), true);
  });

  test("a settled request cannot be re-decided", () => {
    // §4.6 gives Product/Ops the authority so the desk cannot park work alone; allowing a
    // decision to be revisited would hand that power back by another route.
    assert.equal(canDecideChangeRequest({ approvalStatus: "APPROVED" }), false);
    assert.equal(canDecideChangeRequest({ approvalStatus: "REJECTED" }), false);
  });
});

describe("ticketStatusAfterDecision", () => {
  test("approval closes the ticket — the work moves to the backlog", () => {
    assert.equal(ticketStatusAfterDecision("APPROVED"), "CLOSED");
    // And that move must be a legal transition from the awaiting state.
    assert.equal(canTransition("AWAITING_CR_APPROVAL", "CLOSED"), true);
  });

  test("rejection sends the ticket back to the desk rather than closing it", () => {
    assert.equal(ticketStatusAfterDecision("REJECTED"), "IN_PROGRESS");
    assert.equal(canTransition("AWAITING_CR_APPROVAL", "IN_PROGRESS"), true);
  });
});

describe("hasBreachedResponseTarget", () => {
  const open = { slaClockStartAt: at(-30), firstResponseAt: null, status: "OPEN", mergedIntoTicketId: null };

  test("breaches once past the flat target with no first response", () => {
    assert.equal(hasBreachedResponseTarget(open, BASE), true);
  });

  test("does not breach inside the target", () => {
    const fresh = { ...open, slaClockStartAt: at(-2) };
    assert.equal(hasBreachedResponseTarget(fresh, BASE), false);
  });

  test("exactly at the target has not yet breached", () => {
    const boundary = { ...open, slaClockStartAt: at(-24) };
    assert.equal(hasBreachedResponseTarget(boundary, BASE), false);
  });

  test("a ticket that was responded to never breaches, however old", () => {
    assert.equal(hasBreachedResponseTarget({ ...open, firstResponseAt: at(-29) }, BASE), false);
  });

  test("closed and absorbed tickets never breach", () => {
    assert.equal(hasBreachedResponseTarget({ ...open, status: "CLOSED" }, BASE), false);
    assert.equal(hasBreachedResponseTarget({ ...open, mergedIntoTicketId: 5 }, BASE), false);
  });

  test("the target is the same for every category — no severity tiers in Phase 1", () => {
    // §2 records that severity-tiered SLAs were explicitly decided against.
    const twentyFive = { ...open, slaClockStartAt: at(-25) };
    assert.equal(hasBreachedResponseTarget(twentyFive, BASE), true);
    assert.equal(hasBreachedResponseTarget(twentyFive, BASE, 48), false);
  });
});
