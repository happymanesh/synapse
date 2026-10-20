/**
 * The canonical HR employee: the ONLY contract between HR ingestion (src/lib/hr/ingest) and
 * the Synapse lifecycle process (src/lib/hr/lifecycle). Mirrors the hr_employee table.
 *
 * Source-neutral on purpose. Spine today, SIHL's own HR system later: each source gets an
 * ingestion adapter that curates its records into this shape, and the lifecycle process
 * never knows which one produced it. Nothing Spine-specific — field names, the 2079
 * placeholder, status vocabulary — may appear here or downstream of it.
 */
import type { IsoDate } from "./dates";

/**
 * ACTIVE: employed. INACTIVE: the source says not employed (left, resigned, notice, …).
 * UNKNOWN: the source gave no status. The source's own label is kept in sourceStatus.
 */
export type EmploymentStatus = "ACTIVE" | "INACTIVE" | "UNKNOWN";

export interface CanonicalEmployee {
  sourceSystem: string;
  sourceEmployeeId: string;
  /**
   * The same person's earlier employment record in this source, when there is one — e.g. a
   * move between group companies (Spine: Old_Employee_Code). Both records stay live and are
   * separate rows; this is a pointer, not a merge. Lifecycle uses it to tell a company move
   * from a leaver.
   */
  previousSourceEmployeeId: string | null;
  sourceCompanyCode: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  mobile: string | null;
  branch: string | null;
  department: string | null;
  sourceStatus: string | null;
  employmentStatus: EmploymentStatus;
  /** Null means "not leaving". A source's far-future placeholder is curated to null. */
  lastWorkingDate: IsoDate | null;
  /** The source sent a last working date that could not be read. */
  lastWorkingDateInvalid: boolean;
  /** Recorded only; never changes access. Null when the source does not report leave. */
  onLeave: boolean | null;
  /** Everything below is recorded only (added 2026-10-07). None of it changes access. */
  details: EmployeeDetails;
}

/**
 * Employment, organisation, statutory-applicability and HR-group facts. Recorded for
 * reporting; the lifecycle process does not act on any of them.
 *
 * Dates are null when absent or unreadable (curation notes which). Flags are null when the
 * source did not say. leavingReason and frozenReason are HR free text and may hold sensitive
 * detail: show them to HR/admin roles only.
 */
export interface EmployeeDetails {
  // Employment dates and exit
  joinDate: IsoDate | null;
  groupJoinDate: IsoDate | null;
  confirmationDate: IsoDate | null;
  probationDate: IsoDate | null;
  /** Projected retirement (superannuation) date. */
  retirementDate: IsoDate | null;
  resignationDate: IsoDate | null;
  leavingReason: string | null;
  accountFrozen: boolean | null;
  frozenDate: IsoDate | null;
  frozenReason: string | null;
  // Job and organisation
  designation: string | null;
  division: string | null;
  unit: string | null;
  grade: string | null;
  employeeType: string | null;
  jobPostCode: string | null;
  project: string | null;
  isProfessional: boolean | null;
  userGroup: string | null;
  isInternational: boolean | null;
  educationQualification: string | null;
  // Statutory applicability (flags only — no registration numbers are held)
  pfApplicable: boolean | null;
  esicApplicable: boolean | null;
  ptApplicable: boolean | null;
  /** Labour Welfare Fund flags. Not people: there is no reporting-manager field yet. */
  lwfManager: boolean | null;
  lwfSupervisor: boolean | null;
  // HR administration groups
  attendanceGroup: string | null;
  leaveGroup: string | null;
  expenseGroup: string | null;
  timesheetGroup: string | null;
  pmsGroup: string | null;
  addOnServiceGroup: string | null;
  // Reporting line
  /** Manager's employee code in this source. Null until the source provides it (Spine: not yet). */
  reportingManagerCode: string | null;
}

export const DETAIL_FIELDS = [
  "joinDate", "groupJoinDate", "confirmationDate", "probationDate", "retirementDate",
  "resignationDate", "leavingReason", "accountFrozen", "frozenDate", "frozenReason",
  "designation", "division", "unit", "grade", "employeeType", "jobPostCode", "project",
  "isProfessional", "userGroup", "isInternational", "educationQualification",
  "pfApplicable", "esicApplicable", "ptApplicable", "lwfManager", "lwfSupervisor",
  "attendanceGroup", "leaveGroup", "expenseGroup", "timesheetGroup", "pmsGroup", "addOnServiceGroup",
  "reportingManagerCode",
] as const satisfies readonly (keyof EmployeeDetails)[];

/** Core fields compared to detect a change; DETAIL_FIELDS are compared too (see diffEmployee). */
export const TRACKED_FIELDS = [
  "previousSourceEmployeeId",
  "sourceCompanyCode",
  "firstName",
  "lastName",
  "email",
  "mobile",
  "branch",
  "department",
  "sourceStatus",
  "employmentStatus",
  "lastWorkingDate",
  "lastWorkingDateInvalid",
  "onLeave",
] as const satisfies readonly (keyof CanonicalEmployee)[];
