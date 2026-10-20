import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  HR_SUSPENDER,
  decideFreeze,
  decideLeaver,
  decideLifecycle,
  isUnprovisionedJoiner,
  resolveHierarchy,
  type HierarchyMapRow,
  type LeaverInput,
  type LinkedUser,
} from "../src/lib/hr/lifecycle/lifecycle-core";
import { employeeUsername, initialEmployeePassword, planEmployeeUsername } from "../src/lib/hr/lifecycle/username-core";
import { planProfileSync, planProvision } from "../src/lib/hr/lifecycle/lifecycle-core";
import { checkPasswordPolicy } from "../src/lib/password-policy";
import { employeeWelcomeEmail } from "../src/lib/mail/employee-welcome.template";

const TODAY = "2026-10-06";
const active: LinkedUser = { uid: 1, isActive: true, hrManuallyManaged: false };
const emp = (over: Partial<LeaverInput>): LeaverInput => ({
  employmentStatus: "ACTIVE",
  sourceStatus: "Active",
  lastWorkingDate: null,
  lastWorkingDateInvalid: false,
  ...over,
});
const leaver = emp({ employmentStatus: "INACTIVE", sourceStatus: "Resigned", lastWorkingDate: "2026-09-30" });

describe("process boundary", () => {
  test("lifecycle never imports ingestion — it must survive replacing the HR source", () => {
    const dir = join(__dirname, "..", "src", "lib", "hr", "lifecycle");
    for (const f of readdirSync(dir)) {
      const src = readFileSync(join(dir, f), "utf8");
      assert.ok(!/from\s+["'][^"']*\/ingest\//.test(src), `${f} imports from ingest`);
      assert.ok(!/spine/i.test(src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")), `${f} mentions Spine in code`);
    }
  });
});

describe("leaver decision", () => {
  test("active employee keeps access", () => {
    assert.equal(decideLeaver(emp({}), active, TODAY).kind, "NONE");
  });

  test("leaver whose last working day has passed is deactivated from that date", () => {
    const d = decideLeaver(leaver, active, TODAY);
    assert.equal(d.kind, "DEACTIVATE");
    assert.equal(d.kind === "DEACTIVATE" && d.effectiveDate, "2026-09-30");
  });

  test("future last working day is scheduled, then deactivated the day after", () => {
    const notice = emp({ employmentStatus: "INACTIVE", sourceStatus: "Notice Period", lastWorkingDate: "2026-10-31" });
    assert.equal(decideLeaver(notice, active, TODAY).kind, "SCHEDULED");
    assert.equal(decideLeaver(notice, active, "2026-10-31").kind, "SCHEDULED");
    assert.equal(decideLeaver(notice, active, "2026-11-01").kind, "DEACTIVATE");
  });

  test("not active without a usable date goes to review, never deactivation", () => {
    const noDate = decideLeaver(emp({ employmentStatus: "INACTIVE", sourceStatus: "Left" }), active, TODAY);
    assert.equal(noDate.kind, "REVIEW");
    const bad = decideLeaver(emp({ employmentStatus: "INACTIVE", lastWorkingDateInvalid: true }), active, TODAY);
    assert.equal(bad.kind, "REVIEW");
    assert.match(bad.reason, /could not be read/);
  });

  test("unknown status with a passed date is treated as not employed", () => {
    assert.equal(decideLeaver(emp({ employmentStatus: "UNKNOWN", sourceStatus: null, lastWorkingDate: "2026-09-01" }), active, TODAY).kind, "DEACTIVATE");
  });

  test("a passed last working day deactivates even while HR still says Active", () => {
    const d = decideLeaver(emp({ lastWorkingDate: "2026-09-01" }), active, TODAY);
    assert.equal(d.kind, "DEACTIVATE");
    assert.equal(d.kind === "DEACTIVATE" && d.effectiveDate, "2026-09-01");
    assert.equal(decideLeaver(emp({ lastWorkingDate: TODAY }), active, TODAY).kind, "NONE"); // works today
  });

  test("manual override wins, even for a clear leaver", () => {
    assert.equal(decideLeaver(leaver, { ...active, hrManuallyManaged: true }, TODAY).kind, "NONE");
  });

  test("unlinked or already-inactive users are left alone; nothing is ever reactivated", () => {
    assert.equal(decideLeaver(leaver, null, TODAY).kind, "NONE");
    const inactive = { ...active, isActive: false };
    for (const e of [emp({}), leaver, emp({ employmentStatus: "UNKNOWN" })]) {
      assert.equal(decideLeaver(e, inactive, TODAY).kind, "NONE");
    }
  });
});

describe("company moves (Old_Employee_Code)", () => {
  const resignedOld = emp({ employmentStatus: "INACTIVE", sourceStatus: "Resigned", lastWorkingDate: "2026-09-30" });
  const successor = { sourceEmployeeId: "EMP0004", sourceCompanyCode: "C006", employmentStatus: "ACTIVE" as const };

  test("ended record with an active successor is a move: review and re-link, never deactivate", () => {
    const d = decideLeaver(resignedOld, active, TODAY, successor);
    assert.equal(d.kind, "REVIEW");
    assert.match(d.reason, /EMP0004.*C006.*re-link/);
  });

  test("a successor that has itself ended does not save the user", () => {
    assert.equal(decideLeaver(resignedOld, active, TODAY, { ...successor, employmentStatus: "INACTIVE" }).kind, "DEACTIVATE");
  });

  test("a successor never affects an active record or a manually managed user", () => {
    assert.equal(decideLeaver(emp({}), active, TODAY, successor).kind, "NONE");
    assert.equal(decideLeaver(resignedOld, { ...active, hrManuallyManaged: true }, TODAY, successor).kind, "NONE");
  });
});

describe("joiners (reported only)", () => {
  test("an active employee with no linked user is an unprovisioned joiner", () => {
    assert.equal(isUnprovisionedJoiner({ employmentStatus: "ACTIVE" }, false), true);
    assert.equal(isUnprovisionedJoiner({ employmentStatus: "ACTIVE" }, true), false);
    assert.equal(isUnprovisionedJoiner({ employmentStatus: "INACTIVE" }, false), false);
  });
});

describe("branch -> hierarchy mapping", () => {
  const row = (over: Partial<HierarchyMapRow>): HierarchyMapRow => ({
    hrCompanyCode: "C006", hrBranch: "Mumbai", hrDepartment: null,
    companyCode: "SIHL", hierarchyCode: "0200", isActive: true, ...over,
  });
  const rows = [
    row({}),
    row({ hrDepartment: "Developer", hierarchyCode: "0300" }),
    row({ hrBranch: "Pune", hrDepartment: "Sales", hierarchyCode: "0100" }),
    row({ hrBranch: "Delhi", hierarchyCode: "0000", isActive: false }),
  ];
  const at = (sourceCompanyCode: string | null, branch: string | null, department: string | null) =>
    resolveHierarchy({ sourceCompanyCode, branch, department }, rows);

  test("an exact department row wins over the branch's any-department row", () => {
    assert.deepEqual(at("C006", "Mumbai", "Developer"), { kind: "MAPPED", companyCode: "SIHL", hierarchyCode: "0300", matchedOn: "DEPARTMENT" });
    assert.deepEqual(at("C006", "Mumbai", "Operations"), { kind: "MAPPED", companyCode: "SIHL", hierarchyCode: "0200", matchedOn: "BRANCH" });
  });

  test("matching is exact after trim and case-fold", () => {
    assert.equal(at("c006", " MUMBAI ", "developer").kind, "MAPPED");
  });

  test("never infers: near-misses, other companies and inactive rows are unmapped", () => {
    assert.equal(at("C006", "Mumbai West", "Developer").kind, "UNMAPPED");
    assert.equal(at("C006", "Pune", "Sales Support").kind, "UNMAPPED");
    assert.equal(at("C007", "Mumbai", "Developer").kind, "UNMAPPED");
    assert.equal(at("C006", "Delhi", "Research").kind, "UNMAPPED");
    assert.equal(at("C006", null, "Developer").kind, "UNMAPPED");
  });
});

describe("employee usernames (SIHL- + code, min 4 digits)", () => {
  const name = (c: string | null) => {
    const r = employeeUsername(c);
    return r.kind === "OK" ? r.username : r.kind;
  };

  test("1-3 digit codes are zero-padded to 4", () => {
    assert.equal(name("7"), "SIHL-0007");
    assert.equal(name("45"), "SIHL-0045");
    assert.equal(name("123"), "SIHL-0123");
  });

  test("a code that already has a leading zero keeps it and is padded from there", () => {
    assert.equal(name("07"), "SIHL-0007");
  });

  test("4 and 5 digit codes are unchanged; 6+ digits are kept whole, never cut", () => {
    assert.equal(name("1234"), "SIHL-1234");
    assert.equal(name("12345"), "SIHL-12345");
    assert.equal(name("123456"), "SIHL-123456");
    assert.equal(name("1234567"), "SIHL-1234567");
  });

  test("surrounding whitespace is ignored", () => {
    assert.equal(name(" 123 "), "SIHL-0123");
  });

  test("non-numeric or blank codes are not guessed at", () => {
    assert.equal(name("U12345"), "INVALID");
    assert.equal(name("1234_1"), "INVALID");
    assert.equal(name(""), "INVALID");
    assert.equal(name(null), "INVALID");
  });

  test("a taken username is reported, never suffixed — case-insensitively, as login matches", () => {
    assert.deepEqual(planEmployeeUsername("123", new Set(["sihl-0123"])), { kind: "TAKEN", username: "SIHL-0123" });
    assert.deepEqual(planEmployeeUsername("124", new Set(["sihl-0123"])), { kind: "OK", username: "SIHL-0124" });
  });

  test("codes that differ only by leading zeros collide, and the second is caught", () => {
    const taken = new Set<string>();
    const first = planEmployeeUsername("7", taken);
    assert.equal(first.kind, "OK");
    if (first.kind === "OK") taken.add(first.username.toLowerCase());
    assert.equal(planEmployeeUsername("007", taken).kind, "TAKEN");
  });
});

describe("freeze -> suspension", () => {
  const hrSuspended = { ...active, isSuspended: true, suspendedBy: HR_SUSPENDER };

  test("frozen suspends; already suspended is left alone", () => {
    assert.equal(decideFreeze(true, active).kind, "SUSPEND");
    assert.equal(decideFreeze(true, hrSuspended).kind, "NONE");
  });

  test("unfrozen lifts a suspension HR set — and only that one", () => {
    assert.equal(decideFreeze(false, hrSuspended).kind, "UNSUSPEND");
    assert.equal(decideFreeze(false, { ...hrSuspended, suspendedBy: "Admin001" }).kind, "NONE");
    assert.equal(decideFreeze(false, active).kind, "NONE");
  });

  test("unknown freeze state, manual override, unlinked: nothing", () => {
    assert.equal(decideFreeze(null, active).kind, "NONE");
    assert.equal(decideFreeze(null, hrSuspended).kind, "NONE");
    assert.equal(decideFreeze(true, { ...active, hrManuallyManaged: true }).kind, "NONE");
    assert.equal(decideFreeze(true, null).kind, "NONE");
  });

  test("unsuspending is never a back door to reactivation", () => {
    assert.equal(decideFreeze(false, { ...hrSuspended, isActive: false }).kind, "NONE");
    assert.equal(decideFreeze(true, { ...active, isActive: false }).kind, "NONE");
  });

  test("a frozen leaver is deactivated, not merely suspended", () => {
    const d = decideLifecycle({ ...leaver, accountFrozen: true }, active, TODAY);
    assert.equal(d.leaver.kind, "DEACTIVATE");
    assert.equal(d.freeze.kind, "NONE");
  });

  test("a frozen employee still serving notice is suspended now", () => {
    const notice = { ...emp({ employmentStatus: "INACTIVE", sourceStatus: "Resigned", lastWorkingDate: "2026-10-31" }), accountFrozen: true };
    const d = decideLifecycle(notice, active, TODAY);
    assert.equal(d.leaver.kind, "SCHEDULED");
    assert.equal(d.freeze.kind, "SUSPEND");
  });

  test("on leave changes nothing", () => {
    const d = decideLifecycle({ ...emp({}), accountFrozen: false }, active, TODAY);
    assert.deepEqual([d.leaver.kind, d.freeze.kind], ["NONE", "NONE"]);
  });

  test("an employee-code change (company move) keeps the account: review, no block", () => {
    const succ = { sourceEmployeeId: "EMP0004", sourceCompanyCode: "C006", employmentStatus: "ACTIVE" as const };
    const d = decideLifecycle({ ...leaver, accountFrozen: false }, active, TODAY, succ);
    assert.deepEqual([d.leaver.kind, d.freeze.kind], ["REVIEW", "NONE"]);
  });
});

describe("first password (SIHL rule: hyphen -> @)", () => {
  test("SIHL-0123 -> SIHL@0123, and it passes the password policy", () => {
    for (const u of ["SIHL-0007", "SIHL-0123", "SIHL-12345", "SIHL-123456"]) {
      const pw = initialEmployeePassword(u);
      assert.equal(pw, u.replace("-", "@"));
      assert.deepEqual(checkPasswordPolicy(pw, u).errors, [], pw);
    }
  });
});

describe("profile sync from HR", () => {
  const user = { designation: "Analyst", department: "Research", reportingManagerCode: null, reportingManagerSource: null, hrManuallyManaged: false };

  test("copies changed HR values; an HR blank never wipes", () => {
    assert.deepEqual(planProfileSync({ designation: "Sr Analyst", department: null, reportingManagerCode: null }, user), { designation: "Sr Analyst" });
    assert.equal(planProfileSync({ designation: null, department: null, reportingManagerCode: null }, user), null);
  });

  test("an admin-set manager stands until HR supplies one, then HR takes over", () => {
    const adminSet = { ...user, reportingManagerCode: "0101", reportingManagerSource: "ADMIN" };
    assert.equal(planProfileSync({ designation: "Analyst", department: "Research", reportingManagerCode: null }, adminSet), null);
    assert.deepEqual(planProfileSync({ designation: "Analyst", department: "Research", reportingManagerCode: "0202" }, adminSet), {
      reportingManagerCode: "0202",
      reportingManagerSource: "HR",
    });
    // Same code but admin-sourced: HR claims it.
    assert.deepEqual(planProfileSync({ designation: "Analyst", department: "Research", reportingManagerCode: "0101" }, adminSet), {
      reportingManagerCode: "0101",
      reportingManagerSource: "HR",
    });
  });

  test("manually managed users are never touched", () => {
    assert.equal(planProfileSync({ designation: "X", department: "Y", reportingManagerCode: "0202" }, { ...user, hrManuallyManaged: true }), null);
  });
});

describe("joiner provisioning plan", () => {
  const mapped = { kind: "MAPPED" as const, companyCode: "SIHL", hierarchyCode: "0200", matchedOn: "BRANCH" as const };

  test("creates only with a valid username AND an explicit hierarchy mapping", () => {
    assert.deepEqual(planProvision({ kind: "OK", username: "SIHL-0123" }, mapped, null), {
      kind: "CREATE", username: "SIHL-0123", companyCode: "SIHL", hierarchyCode: "0200",
    });
    assert.equal(planProvision({ kind: "OK", username: "SIHL-0123" }, { kind: "UNMAPPED", reason: "No mapping for x" }, null).kind, "BLOCKED");
    assert.equal(planProvision({ kind: "INVALID", reason: "not numeric" }, mapped, null).kind, "BLOCKED");
    assert.equal(planProvision({ kind: "TAKEN", username: "SIHL-0123" }, mapped, null).kind, "BLOCKED");
  });

  test("an unlinked account with the same email may be this person: link, do not duplicate", () => {
    const p = planProvision({ kind: "OK", username: "SIHL-0123" }, mapped, "Manesh001");
    assert.equal(p.kind, "BLOCKED");
    assert.match(p.kind === "BLOCKED" ? p.reason : "", /Manesh001.*link it instead/);
  });
});

describe("welcome email", () => {
  test("carries username, first password and sign-in link; escapes HTML", () => {
    const m = employeeWelcomeEmail({
      recipientName: "Asha <Test>", username: "SIHL-0123", initialPassword: "SIHL@0123",
      loginUrl: "https://synapse.example/login", productName: "SIHL Synapse", when: new Date("2026-10-07T06:00:00Z"),
    });
    assert.match(m.subject, /SIHL-0123/);
    assert.match(m.text, /Username: SIHL-0123/);
    assert.match(m.text, /Password: SIHL@0123/);
    assert.match(m.text, /choose a new password the first time/);
    assert.ok(m.html.includes("Asha &lt;Test&gt;"));
    assert.ok(!m.html.includes("<Test>"));
  });
});
