/**
 * Process B rules — what a canonical HR employee means for a Synapse user. Pure; no Prisma,
 * no `server-only`. Tested in tests/hr-lifecycle-core.test.ts.
 *
 * Source-agnostic: imports only the canonical contract (../employee), never anything under
 * ../ingest — a test enforces that. Replacing Spine with SIHL's own HR system must not
 * change a line here.
 *
 * Design rules (decided 2026-09-25):
 *   1. One-way HR -> Synapse, never write back.
 *   2. Employment facts only, never roles or menus. HR must not imply access.
 *   3. Leaver path first. Joiner provisioning is phase two — blocked on Synapse having no
 *      invite/set-password flow (password_hash is mandatory).
 *   4. Branch/Department -> hierarchy only through hr_branch_hierarchy_map, never inferred.
 *   5. Auto-apply only what removes access (deactivation); queue anything else for review.
 *      Exception (SIHL, 2026-10-07): an HR freeze suspends the account and an HR unfreeze
 *      lifts that suspension automatically — only a suspension HR set, never one an admin
 *      set, and never a deactivation.
 *   6. Link users by user_details.hr_employee_id -> hr_employee.id, never customer_id.
 *   7. Manual override wins: hr_manually_managed users are never touched.
 * Leave is recorded on hr_employee only and never changes access (decided 2026-10-06).
 *
 * Per run, for each linked user (SIHL, 2026-10-07):
 *   - last working day passed (any HR status)          -> DEACTIVATE
 *   - HR freeze                                         -> SUSPEND (lifted when unfrozen)
 *   - employee-code change (company move)               -> no account change; admin re-links
 *   - on leave                                          -> no change
 */
import type { IsoDate } from "../dates";
import type { CanonicalEmployee } from "../employee";

// ---------------------------------------------------------------------------
// Leavers
// ---------------------------------------------------------------------------

export type LeaverInput = Pick<
  CanonicalEmployee,
  "employmentStatus" | "sourceStatus" | "lastWorkingDate" | "lastWorkingDateInvalid"
>;

export interface LinkedUser {
  uid: number;
  isActive: boolean;
  hrManuallyManaged: boolean;
  /** Optional so leaver-only callers need not supply it; treated as not suspended. */
  isSuspended?: boolean;
  /** Who set the suspension. The lifecycle only lifts its own (HR_SUSPENDER). */
  suspendedBy?: string | null;
}

/** suspended_by value for suspensions the HR lifecycle sets — and the only ones it lifts. */
export const HR_SUSPENDER = "HR_SYNC";

export type LeaverDecision =
  /** Nothing to do. `reason` is for the report only. */
  | { kind: "NONE"; reason: string }
  /** Last working day has passed: remove access now. Safe to auto-apply (rule 5). */
  | { kind: "DEACTIVATE"; effectiveDate: IsoDate; reason: string }
  /** Leaving on a future date. Re-evaluated every run; becomes DEACTIVATE the day after. */
  | { kind: "SCHEDULED"; effectiveDate: IsoDate; reason: string }
  /** HR data is contradictory or incomplete. An admin decides; nothing is changed. */
  | { kind: "REVIEW"; reason: string };

/** A later employment record of the same person (its previousSourceEmployeeId points here). */
export type Successor = Pick<CanonicalEmployee, "sourceEmployeeId" | "sourceCompanyCode" | "employmentStatus">;

/**
 * Whether an HR record means a Synapse user must lose access.
 *
 * Access ends after the last working day, so a user whose LWD is today keeps access until
 * tomorrow's run. Never returns anything that grants or restores access.
 *
 * A record that has ended but has an ACTIVE successor is a move between group companies,
 * not a leaver: it goes to review so an admin re-links the user to the new record (and
 * decides whether the new company changes their access). It is never auto-deactivated.
 */
export function decideLeaver(
  emp: LeaverInput,
  user: LinkedUser | null,
  today: IsoDate,
  successor: Successor | null = null,
): LeaverDecision {
  if (!user) return { kind: "NONE", reason: "No Synapse user linked to this employee" };
  if (user.hrManuallyManaged) return { kind: "NONE", reason: "User is manually managed" };
  if (!user.isActive) return { kind: "NONE", reason: "User is already inactive" };

  const lwd = emp.lastWorkingDate;
  const label = emp.sourceStatus ?? "(blank)";

  if (emp.employmentStatus === "ACTIVE") {
    // SIHL, 2026-10-07: a passed last working day ends access even while HR still says
    // Active (e.g. a retirement date HR has not yet acted on).
    if (lwd && lwd < today) {
      return { kind: "DEACTIVATE", effectiveDate: lwd, reason: `HR status ${label}, but last working date ${lwd} has passed` };
    }
    return { kind: "NONE", reason: "Employee is active" };
  }

  // INACTIVE or UNKNOWN.
  if (successor?.employmentStatus === "ACTIVE") {
    return {
      kind: "REVIEW",
      reason:
        `HR status ${label}, but continues as employee ${successor.sourceEmployeeId}` +
        ` (company ${successor.sourceCompanyCode ?? "unknown"}): re-link the user to the new record`,
    };
  }
  if (lwd) {
    return lwd < today
      ? { kind: "DEACTIVATE", effectiveDate: lwd, reason: `HR status ${label}, last working date ${lwd}` }
      : { kind: "SCHEDULED", effectiveDate: lwd, reason: `HR status ${label}, leaving after ${lwd}` };
  }
  return {
    kind: "REVIEW",
    reason: emp.lastWorkingDateInvalid
      ? `HR status ${label} and last working date could not be read`
      : `HR status ${label} but no last working date`,
  };
}

// ---------------------------------------------------------------------------
// Freeze -> suspension
// ---------------------------------------------------------------------------

export type FreezeDecision =
  | { kind: "NONE" }
  /** HR has frozen the employee: block the account, restorably. */
  | { kind: "SUSPEND"; reason: string }
  /** HR has unfrozen the employee: lift the suspension the lifecycle itself set. */
  | { kind: "UNSUSPEND"; reason: string };

/**
 * Freeze handling, independent of the leaver decision (decideLifecycle combines them).
 * Unknown freeze state (null) never changes anything, and a deactivated user is never touched
 * — lifting a suspension must not be a back door to reactivation.
 */
export function decideFreeze(accountFrozen: boolean | null, user: LinkedUser | null): FreezeDecision {
  if (!user || user.hrManuallyManaged || !user.isActive || accountFrozen === null) return { kind: "NONE" };
  const suspended = user.isSuspended === true;
  if (accountFrozen && !suspended) return { kind: "SUSPEND", reason: "HR has frozen this employee" };
  if (!accountFrozen && suspended && user.suspendedBy === HR_SUSPENDER) {
    return { kind: "UNSUSPEND", reason: "HR has unfrozen this employee" };
  }
  return { kind: "NONE" };
}

export interface LifecycleDecision {
  leaver: LeaverDecision;
  freeze: FreezeDecision;
}

/**
 * Everything one run decides for one linked user. Deactivation outranks suspension: a leaver
 * whose record is also frozen is deactivated, not merely suspended.
 */
export function decideLifecycle(
  emp: LeaverInput & { accountFrozen: boolean | null },
  user: LinkedUser | null,
  today: IsoDate,
  successor: Successor | null = null,
): LifecycleDecision {
  const leaver = decideLeaver(emp, user, today, successor);
  const freeze: FreezeDecision = leaver.kind === "DEACTIVATE" ? { kind: "NONE" } : decideFreeze(emp.accountFrozen, user);
  return { leaver, freeze };
}

// ---------------------------------------------------------------------------
// Joiners (phase two — reported, never acted on)
// ---------------------------------------------------------------------------

/**
 * An active employee with no linked Synapse user. Phase one only counts these: creating a
 * user needs a set-password flow Synapse does not have, and linking an existing account is
 * an admin decision.
 */
export function isUnprovisionedJoiner(emp: Pick<CanonicalEmployee, "employmentStatus">, linked: boolean): boolean {
  return emp.employmentStatus === "ACTIVE" && !linked;
}

// ---------------------------------------------------------------------------
// Branch/Department -> hierarchy (rule 4) — for phase two provisioning
// ---------------------------------------------------------------------------

export interface HierarchyMapRow {
  hrCompanyCode: string;
  hrBranch: string;
  hrDepartment: string | null;
  companyCode: string;
  hierarchyCode: string;
  isActive: boolean;
}

export type HierarchyResolution =
  | { kind: "MAPPED"; companyCode: string; hierarchyCode: string; matchedOn: "DEPARTMENT" | "BRANCH" }
  | { kind: "UNMAPPED"; reason: string };

/** Exact match after trim + case-fold. Normalisation only — never partial or fuzzy. */
const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/**
 * Resolve an employee's Synapse company + hierarchy from the admin-maintained mapping. An
 * exact (branch, department) row wins over the branch's any-department row; anything else
 * is UNMAPPED and must go to review — there is deliberately no fallback.
 */
export function resolveHierarchy(
  emp: Pick<CanonicalEmployee, "sourceCompanyCode" | "branch" | "department">,
  rows: HierarchyMapRow[],
): HierarchyResolution {
  if (!norm(emp.branch)) return { kind: "UNMAPPED", reason: "Employee has no branch in HR" };
  const candidates = rows.filter(
    (r) => r.isActive && norm(r.hrCompanyCode) === norm(emp.sourceCompanyCode) && norm(r.hrBranch) === norm(emp.branch),
  );
  const exact = norm(emp.department)
    ? candidates.find((r) => r.hrDepartment !== null && norm(r.hrDepartment) === norm(emp.department))
    : undefined;
  if (exact) return { kind: "MAPPED", companyCode: exact.companyCode, hierarchyCode: exact.hierarchyCode, matchedOn: "DEPARTMENT" };
  const anyDept = candidates.find((r) => r.hrDepartment === null);
  if (anyDept) return { kind: "MAPPED", companyCode: anyDept.companyCode, hierarchyCode: anyDept.hierarchyCode, matchedOn: "BRANCH" };
  return {
    kind: "UNMAPPED",
    reason: `No mapping for ${emp.sourceCompanyCode ?? "(no company)"} / ${emp.branch} / ${emp.department ?? "(no department)"}`,
  };
}

// ---------------------------------------------------------------------------
// Profile sync (linked users) — designation, department, reporting manager
// ---------------------------------------------------------------------------

export interface ProfileFromHr {
  designation: string | null;
  department: string | null;
  reportingManagerCode: string | null;
}

export interface UserProfile {
  designation: string | null;
  department: string | null;
  reportingManagerCode: string | null;
  reportingManagerSource: string | null;
  hrManuallyManaged: boolean;
}

export type ProfileUpdate = Partial<{
  designation: string;
  department: string;
  reportingManagerCode: string;
  reportingManagerSource: "HR";
}>;

/**
 * What to copy from HR onto a linked user. Display facts only — nothing here grants access.
 *
 * HR only ever fills or overwrites with a real value; an HR blank never wipes what is there.
 * That is what lets an administrator set the reporting manager today: Spine sends none, so the
 * admin value stands; once Spine does, HR takes over (source "HR"). A manually managed user is
 * never touched (rule 7).
 */
export function planProfileSync(hr: ProfileFromHr, user: UserProfile): ProfileUpdate | null {
  if (user.hrManuallyManaged) return null;
  const update: ProfileUpdate = {};
  if (hr.designation && hr.designation !== user.designation) update.designation = hr.designation;
  if (hr.department && hr.department !== user.department) update.department = hr.department;
  if (hr.reportingManagerCode && (hr.reportingManagerCode !== user.reportingManagerCode || user.reportingManagerSource !== "HR")) {
    update.reportingManagerCode = hr.reportingManagerCode;
    update.reportingManagerSource = "HR";
  }
  return Object.keys(update).length ? update : null;
}

// ---------------------------------------------------------------------------
// Joiner provisioning
// ---------------------------------------------------------------------------

export type ProvisionPlan =
  | { kind: "CREATE"; username: string; companyCode: string; hierarchyCode: string }
  /** Cannot be created automatically; the reason says what an admin must fix. */
  | { kind: "BLOCKED"; reason: string };

/**
 * Whether an unprovisioned active employee can be created automatically, and as what.
 * Needs a valid username (SIHL- rule, not taken) AND an explicit hierarchy mapping (rule 4):
 * the account's company and hierarchy come only from hr_branch_hierarchy_map, never a guess.
 */
export function planProvision(
  username: { kind: "OK"; username: string } | { kind: "INVALID"; reason: string } | { kind: "TAKEN"; username: string },
  hierarchy: HierarchyResolution,
  existingAccountWithEmail: string | null,
): ProvisionPlan {
  if (username.kind === "INVALID") return { kind: "BLOCKED", reason: username.reason };
  if (username.kind === "TAKEN") return { kind: "BLOCKED", reason: `username ${username.username} is already in use` };
  if (hierarchy.kind === "UNMAPPED") return { kind: "BLOCKED", reason: hierarchy.reason };
  // A Synapse account already using this person's email may BE this person (created by hand
  // before the HR link existed). Creating a second account would split their access; an admin
  // links the existing one instead.
  if (existingAccountWithEmail) {
    return { kind: "BLOCKED", reason: `existing account ${existingAccountWithEmail} has the same email — link it instead` };
  }
  return { kind: "CREATE", username: username.username, companyCode: hierarchy.companyCode, hierarchyCode: hierarchy.hierarchyCode };
}
