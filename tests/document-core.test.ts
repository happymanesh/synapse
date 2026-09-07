import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  planDocumentDelivery,
  requiresClientCode,
  isClientHierarchy,
  validatePeriod,
  UnavailableDocumentGenerator,
  type ClientInfo,
  type RequesterInfo,
} from "../src/lib/document-core";

const client = (over: Partial<RequesterInfo> = {}): RequesterInfo => ({
  uid: 50,
  hierarchyCode: "0800",
  email: "client@example.com",
  customerId: "C1001",
  ...over,
});

const staff = (over: Partial<RequesterInfo> = {}): RequesterInfo => ({
  uid: 9,
  hierarchyCode: "0200",
  email: "desk@sihl.local",
  customerId: null,
  ...over,
});

const target = (over: Partial<ClientInfo> = {}): ClientInfo => ({
  uid: 77,
  email: "target@example.com",
  customerId: "C2002",
  ...over,
});

describe("requiresClientCode", () => {
  test("only a ledger demands one (§4.7)", () => {
    assert.equal(requiresClientCode("LEDGER"), true);
    assert.equal(requiresClientCode("MARGIN_REPORT"), false);
    assert.equal(requiresClientCode("CONTRACT_NOTE"), false);
  });
});

describe("isClientHierarchy", () => {
  test("clients and family accounts are account holders", () => {
    assert.equal(isClientHierarchy("0800"), true);
    assert.equal(isClientHierarchy("0700"), true);
  });

  test("internal tiers are not", () => {
    for (const h of ["0000", "0100", "0200", "0300", "0400", "9999"]) {
      assert.equal(isClientHierarchy(h), false, h);
    }
  });
});

describe("planDocumentDelivery — a client requesting their own document", () => {
  test("goes to their registered address, with no CC", () => {
    const plan = planDocumentDelivery(client(), null, "C1001");
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    assert.equal(plan.deliverTo, "client@example.com");
    assert.equal(plan.cc, null);
    assert.equal(plan.selfService, true);
    assert.equal(plan.forClientUid, 50);
  });

  test("a submitted client code is IGNORED in favour of their own", () => {
    // The whole control. With no OTP in the flow, trusting a submitted code would let any
    // signed-in client pull any other client's ledger by typing a different number.
    const plan = planDocumentDelivery(client(), target(), "C9999-SOMEONE-ELSE");
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    assert.equal(plan.clientCode, "C1001");
    assert.equal(plan.deliverTo, "client@example.com");
  });

  test("the address is never taken from another record, even one that was resolved", () => {
    const plan = planDocumentDelivery(client(), target({ email: "attacker@example.com" }), "C2002");
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    assert.notEqual(plan.deliverTo, "attacker@example.com");
  });

  test("no registered email means refused, not delivered elsewhere", () => {
    const plan = planDocumentDelivery(client({ email: null }), null, "C1001");
    assert.equal(plan.ok, false);
  });

  test("no client code on their own record means refused", () => {
    const plan = planDocumentDelivery(client({ customerId: null }), null, "C1001");
    assert.equal(plan.ok, false);
  });
});

describe("planDocumentDelivery — staff requesting on a client's behalf", () => {
  test("goes to the requester with the client CC'd (§4.7 transparency)", () => {
    const plan = planDocumentDelivery(staff(), target(), "C2002");
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    assert.equal(plan.deliverTo, "desk@sihl.local");
    assert.equal(plan.cc, "target@example.com");
    assert.equal(plan.selfService, false);
    assert.equal(plan.forClientUid, 77);
  });

  test("the client code comes from the resolved record, not the typed string", () => {
    const plan = planDocumentDelivery(staff(), target({ customerId: "C2002" }), "c2002 ");
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    assert.equal(plan.clientCode, "C2002");
  });

  test("an unknown client code is refused", () => {
    assert.equal(planDocumentDelivery(staff(), null, "C-NOPE").ok, false);
  });

  test("a missing client code is refused", () => {
    assert.equal(planDocumentDelivery(staff(), null, null).ok, false);
  });

  test("a client with no email is refused — there is nothing to verify against", () => {
    // §4.7's verification IS the registered address; without one the control does not exist.
    assert.equal(planDocumentDelivery(staff(), target({ email: null }), "C2002").ok, false);
  });

  test("staff with no email of their own is refused", () => {
    assert.equal(planDocumentDelivery(staff({ email: null }), target(), "C2002").ok, false);
  });

  test("the client is always copied — a pull on their account is never invisible", () => {
    const plan = planDocumentDelivery(staff(), target(), "C2002");
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    assert.ok(plan.cc && plan.cc.length > 0);
  });
});

describe("validatePeriod", () => {
  const day = 86400000;
  test("accepts a sensible range", () => {
    assert.equal(validatePeriod(new Date(Date.now() - 30 * day), new Date()), null);
  });

  test("rejects a backwards range", () => {
    assert.ok(validatePeriod(new Date(), new Date(Date.now() - day)));
  });

  test("rejects a future end date", () => {
    assert.ok(validatePeriod(null, new Date(Date.now() + 10 * day)));
  });

  test("an open-ended period is allowed", () => {
    assert.equal(validatePeriod(null, null), null);
  });
});

describe("UnavailableDocumentGenerator", () => {
  test("reports unavailable with a reason rather than pretending", () => {
    return new UnavailableDocumentGenerator()
      .generate({ documentType: "LEDGER", clientCode: "C1001", fromDate: null, toDate: null })
      .then((r) => {
        assert.equal(r.available, false);
        if (r.available) return;
        assert.ok(r.reason.length > 0);
      });
  });
});
