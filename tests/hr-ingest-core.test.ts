import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SPINE_FIELDS,
  SpineApiError,
  extractEmployeeRecords,
  formatReqDate,
  pickSpineFields,
  sanitizeSpineMessage,
} from "../src/lib/hr/ingest/spine-core";
import {
  curateSpineRecord,
  diffEmployee,
  isPlaceholderDate,
  parseSpineDate,
  planIngestDates,
  spineEmploymentStatus,
  supersededPositions,
} from "../src/lib/hr/ingest/curate-core";
import { SpineClient } from "../src/lib/hr/ingest/spine-client";
import { todayInIndia } from "../src/lib/hr/dates";

const fixture = (name: string) => JSON.parse(readFileSync(join(__dirname, "fixtures", "spine", name), "utf8"));

const EMPLOYEES: Record<string, unknown>[] = fixture("employee-service.json");
const TODAY = "2026-10-06";
/** Every fake sensitive value in the fixture is prefixed FAKE-; none may survive landing. */
const SENSITIVE_MARKER = "FAKE-";

const curated = (i: number) => curateSpineRecord(pickSpineFields(EMPLOYEES[i]), TODAY);

describe("landing (field filter)", () => {
  test("exactly 43 fields are taken", () => {
    assert.equal(SPINE_FIELDS.length, 43);
    assert.equal(Object.keys(pickSpineFields(EMPLOYEES[0])).length, 43);
  });

  test("the never-store groups stay out, whatever is added later", () => {
    const forbidden = /caste|relig|gender|birth|father|spouse|child|photo|height|weight|identification|marital|blood|divyang|abled|challenge|aadhar|pan_card|bank|election|ration|population|uan|pran|pt_no|fpf|esic_(old|imp)|member_id|payment|tds|tax|vpf|gratuity|jv_code|increment|permanent_|_local$|country|staying|phone|extension|alternate_email|cc_email|linkedin|twitter|^title$|aka|middle|remark|createdon|lastmodify/i;
    assert.deepEqual(SPINE_FIELDS.filter((f) => forbidden.test(f)), []);
  });

  test("caste, religion, disability, bank, PAN and Aadhaar never reach the raw row", () => {
    for (const raw of EMPLOYEES) {
      const landed = JSON.stringify(pickSpineFields(raw));
      assert.ok(!landed.includes(SENSITIVE_MARKER), landed);
    }
  });

  test("values land exactly as sent — no trimming, placeholders kept", () => {
    const landed = pickSpineFields(EMPLOYEES[0]);
    assert.equal(landed.lastWorkingDate, "2079-08-18T00:00:00");
    assert.equal(pickSpineFields(EMPLOYEES[5]).employeeCode, "   ");
  });

  test("a non-object still lands, as an all-null row, so it is rejected visibly", () => {
    const landed = pickSpineFields("garbage");
    assert.ok(Object.values(landed).every((v) => v === null));
  });

  test("accepts a bare array or a {data} envelope; a failure envelope throws", () => {
    assert.equal(extractEmployeeRecords(EMPLOYEES).length, 6);
    assert.equal(extractEmployeeRecords({ isSuccess: true, data: EMPLOYEES }).length, 6);
    assert.deepEqual(extractEmployeeRecords({ isSuccess: true, data: null }), []);
    assert.throws(() => extractEmployeeRecords({ isSuccess: false, statusCode: "SP1", msg: "x" }), SpineApiError);
    assert.throws(() => extractEmployeeRecords("nope"), SpineApiError);
  });
});

describe("error sanitising", () => {
  test("a failed token call does not leak the echoed client key", () => {
    const msg = sanitizeSpineMessage(fixture("token-invalid-key.json").msg);
    assert.ok(!msg.includes("0123456789abcdef"), msg);
    assert.ok(msg.includes("Key Not Found"));
    assert.ok(!msg.includes("<br/>"));
  });

  test("bearer tokens and long hex strings are redacted", () => {
    assert.equal(sanitizeSpineMessage("bad Bearer abc.def.ghi"), "bad Bearer [redacted]");
    assert.ok(!sanitizeSpineMessage("id deadbeefdeadbeefdeadbeefdeadbeef").includes("deadbeef"));
  });
});

describe("dates", () => {
  test("ReqDate is dd-MMM-yyyy", () => {
    assert.equal(formatReqDate("2026-10-06"), "06-Oct-2026");
    assert.equal(formatReqDate("2026-01-31"), "31-Jan-2026");
  });

  test("today is the Indian calendar date, whatever the server zone", () => {
    assert.equal(todayInIndia(new Date("2026-10-05T20:00:00Z")), "2026-10-06");
    assert.equal(todayInIndia(new Date("2026-10-05T18:00:00Z")), "2026-10-05");
  });

  test("parses Spine's ISO form, never guesses at others", () => {
    assert.deepEqual(parseSpineDate("2026-09-30T00:00:00"), { kind: "DATE", date: "2026-09-30" });
    assert.deepEqual(parseSpineDate(" 2026-09-30 "), { kind: "DATE", date: "2026-09-30" });
    assert.deepEqual(parseSpineDate(null), { kind: "NONE" });
    assert.deepEqual(parseSpineDate("31/09/2026"), { kind: "INVALID" });
    assert.deepEqual(parseSpineDate("2026-02-30T00:00:00"), { kind: "INVALID" });
  });

  test("2079 is a placeholder; a notice-period date is not", () => {
    assert.equal(isPlaceholderDate("2079-08-18", TODAY), true);
    assert.equal(isPlaceholderDate("2027-12-31", TODAY), true);
    assert.equal(isPlaceholderDate("2026-10-31", TODAY), false);
    assert.equal(isPlaceholderDate("2027-01-31", TODAY), false);
  });
});

describe("curation", () => {
  test("active employee: 2079 placeholder becomes 'not leaving'", () => {
    const r = curated(0);
    assert.equal(r.employee?.employmentStatus, "ACTIVE");
    assert.equal(r.employee?.lastWorkingDate, null);
    assert.equal(r.employee?.lastWorkingDateInvalid, false);
    assert.equal(r.employee?.sourceSystem, "SPINE");
    assert.equal(r.employee?.onLeave, null);
  });

  test("leaver keeps a real last working date and the source's status label", () => {
    const e = curated(1).employee!;
    assert.equal(e.employmentStatus, "INACTIVE");
    assert.equal(e.sourceStatus, "Resigned");
    assert.equal(e.lastWorkingDate, "2026-09-30");
  });

  test("an unreadable date is flagged and warned, not guessed", () => {
    const r = curated(4);
    assert.equal(r.status, "WARNED");
    assert.equal(r.employee?.lastWorkingDate, null);
    assert.equal(r.employee?.lastWorkingDateInvalid, true);
    assert.ok(r.notes.some((n) => /Last_Working_Date/.test(n)));
  });

  test("a blank Employee_Code is rejected", () => {
    const r = curated(5);
    assert.equal(r.status, "REJECTED");
    assert.equal(r.employee, null);
  });

  test("Old_Employee_Code is carried as a pointer to the earlier record", () => {
    assert.equal(curated(3).employee?.previousSourceEmployeeId, "OLD0004");
  });

  test("status vocabulary: only Active is employed; blank is unknown", () => {
    assert.equal(spineEmploymentStatus(" active "), "ACTIVE");
    assert.equal(spineEmploymentStatus("Inactive"), "INACTIVE");
    for (const s of ["Resigned", "Terminated", "Transferred", "Expired"]) assert.equal(spineEmploymentStatus(s), "INACTIVE");
    assert.equal(spineEmploymentStatus(null), "UNKNOWN");
    assert.equal(spineEmploymentStatus("  "), "UNKNOWN");
  });

  test("email is lower-cased; an invalid one is dropped with a warning", () => {
    const base = pickSpineFields(EMPLOYEES[1]);
    assert.equal(curateSpineRecord({ ...base, email: " B.Test@Example.INVALID " }, TODAY).employee?.email, "b.test@example.invalid");
    const bad = curateSpineRecord({ ...base, email: "not-an-email" }, TODAY);
    assert.equal(bad.status, "WARNED");
    assert.equal(bad.employee?.email, null);
  });

  test("mobile is reduced to 10 digits; odd lengths are kept but warned", () => {
    const base = pickSpineFields(EMPLOYEES[1]);
    assert.equal(curateSpineRecord({ ...base, mobile: "+91 98765-43210" }, TODAY).employee?.mobile, "9876543210");
    assert.equal(curateSpineRecord({ ...base, mobile: "09876543210" }, TODAY).employee?.mobile, "9876543210");
    const odd = curateSpineRecord({ ...base, mobile: "900000002" }, TODAY);
    assert.equal(odd.status, "WARNED");
    assert.equal(odd.employee?.mobile, "900000002");
  });

  test("names and text fields are trimmed and whitespace-collapsed", () => {
    const base = pickSpineFields(EMPLOYEES[1]);
    const e = curateSpineRecord({ ...base, firstName: "  Bala  ", branch: "Navi   Mumbai " }, TODAY).employee!;
    assert.equal(e.firstName, "Bala");
    assert.equal(e.branch, "Navi Mumbai");
  });
});

describe("details (recorded only)", () => {
  test("dates, Yes/No flags and numeric codes are curated to types", () => {
    const d = curated(0).employee!.details;
    assert.equal(d.joinDate, "2026-03-06");
    assert.equal(d.retirementDate, "2079-08-18"); // retirement date is kept as sent
    assert.equal(d.confirmationDate, null); // far-future placeholder dropped
    assert.equal(d.accountFrozen, false);
    assert.equal(d.pfApplicable, true);
    assert.equal(d.isInternational, null);
    assert.equal(d.attendanceGroup, "1"); // Spine sends this one as a number
    assert.equal(d.designation, "Software Engineer");
  });

  test("leaver details: resignation, freeze, free-text reasons", () => {
    const d = curated(1).employee!.details;
    assert.equal(d.resignationDate, "2026-08-31");
    assert.equal(d.accountFrozen, true);
    assert.equal(d.frozenDate, "2026-09-30");
    assert.equal(d.leavingReason, "Better opportunity (test)");
    assert.equal(d.confirmationDate, "2021-10-01");
  });

  test("a flag that is not Yes/No is not guessed: null, with a warning", () => {
    const r = curated(1);
    assert.equal(r.employee!.details.pfApplicable, null);
    assert.equal(r.status, "WARNED");
    assert.ok(r.notes.includes("PF_Flag is not Yes/No; not taken"));
  });

  test("details never change employment status", () => {
    const base = pickSpineFields(EMPLOYEES[0]);
    const frozen = curateSpineRecord({ ...base, freezeAccount: "Yes", resignOfferDate: "2026-09-01T00:00:00" }, TODAY);
    assert.equal(frozen.employee!.employmentStatus, "ACTIVE");
  });

  test("changes to details are detected", () => {
    const a = curated(0).employee!;
    const b = { ...a, details: { ...a.details, accountFrozen: true, grade: "B Grade" } };
    assert.deepEqual(diffEmployee(a, b).map((c) => c.field), ["accountFrozen", "grade"]);
  });
});

describe("batch handling", () => {
  test("the last record for a code wins; earlier ones are superseded", () => {
    assert.deepEqual([...supersededPositions(["A", "B", "A", null, " B ", null])], [0, 1]);
  });


  test("diff reports changed tracked fields only", () => {
    const before = curated(2).employee!;
    assert.deepEqual(diffEmployee(before, before), []);
    const after = { ...before, lastWorkingDate: "2026-11-15", department: "Ops" };
    assert.deepEqual(diffEmployee(before, after), [
      { field: "department", oldValue: "Operations", newValue: "Ops" },
      { field: "lastWorkingDate", oldValue: "2026-10-31", newValue: "2026-11-15" },
    ]);
  });
});

describe("which dates to fetch", () => {
  const today = "2026-10-07";

  test("nightly: resumes the day after the last success, up to yesterday", () => {
    assert.deepEqual(planIngestDates({ lastSucceeded: "2026-10-03", today }), ["2026-10-04", "2026-10-05", "2026-10-06"]);
    assert.deepEqual(planIngestDates({ lastSucceeded: "2026-10-06", today }), []);
  });

  test("the first run refuses to guess — it must be told where the initial load starts", () => {
    assert.throws(() => planIngestDates({ lastSucceeded: null, today }), /--from 2026-07-10/);
    const all = planIngestDates({ lastSucceeded: null, today, from: "2026-07-10" });
    assert.equal(all[0], "2026-07-10");
    assert.equal(all.at(-1), "2026-10-06");
    assert.equal(all.length, 89);
  });

  test("explicit backfill, and today is never fetched", () => {
    assert.deepEqual(planIngestDates({ lastSucceeded: "2026-10-06", today, from: "2026-09-01", to: "2026-09-02" }), ["2026-09-01", "2026-09-02"]);
    assert.throws(() => planIngestDates({ lastSucceeded: null, today, from: "2026-10-01", to: today }), /before today/);
  });

  test("one invocation is capped; the next run continues", () => {
    assert.equal(planIngestDates({ lastSucceeded: null, today, from: "2026-01-01" }).length, 120);
  });
});

describe("Spine client (stubbed fetch)", () => {
  const creds = { baseUrl: "https://spine.test", clientKey: "k", productKey: "p", clientSecret: "s" };

  function stub(responses: Record<string, unknown>) {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const impl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
      const key = Object.keys(responses).find((k) => url.includes(k))!;
      return new Response(JSON.stringify(responses[key]), { status: 200 });
    }) as unknown as typeof fetch;
    return { impl, calls };
  }

  test("one token, sent as a bearer; only the 11 fields come back", async () => {
    const { impl, calls } = stub({
      GenerateAccessKey: { isSuccess: true, msg: "", data: "tok123", statusCode: "" },
      EmployeeService: EMPLOYEES,
    });
    const client = new SpineClient(creds, impl);
    const rows = await client.getEmployees("Modified", "2026-10-05");
    await client.getEmployees("Created", "2026-10-05");

    assert.equal(calls.filter((c) => c.url.includes("GenerateAccessKey")).length, 1);
    assert.deepEqual(calls[0].headers, { ClientKey: "k", ProductKey: "p", ClientSecret: "s" });
    assert.equal(calls[1].headers.Authorization, "Bearer tok123");
    assert.match(calls[1].url, /ReqType=Modified&ReqDate=05-Oct-2026$/);
    assert.equal(rows.length, 6);
    assert.ok(!JSON.stringify(rows).includes(SENSITIVE_MARKER));
  });

  test("an unregistered key fails with a sanitised error", async () => {
    const { impl } = stub({ GenerateAccessKey: fixture("token-invalid-key.json") });
    await assert.rejects(new SpineClient(creds, impl).getEmployees("Modified", "2026-10-05"), (e: Error) => {
      assert.ok(e instanceof SpineApiError);
      assert.match(e.message, /SP4002/);
      assert.ok(!e.message.includes("0123456789abcdef"));
      return true;
    });
  });
});
