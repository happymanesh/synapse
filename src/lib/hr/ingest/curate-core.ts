/**
 * Curation: Spine raw record -> canonical employee, plus change detection against hr_employee. Pure; no Prisma, no `server-only`. Tested in
 * tests/hr-ingest-core.test.ts.
 *
 * This is where everything Spine-specific about *meaning* is resolved, so that nothing
 * downstream of hr_employee has to know it: the status vocabulary, the 2079 placeholder,
 * the date format. A future HR source gets its own curate function producing the same
 * CanonicalEmployee.
 *
 * Outcomes per record:
 *   ACCEPTED — clean.
 *   WARNED   — accepted, but a field was dropped or looks wrong (notes say which).
 *   REJECTED — cannot be keyed or contradicts itself; hr_employee is not touched.
 */
import { addDays, type IsoDate } from "../dates";
import { DETAIL_FIELDS, TRACKED_FIELDS, type CanonicalEmployee, type EmployeeDetails, type EmploymentStatus } from "../employee";
import type { SpineRawEmployee } from "./spine-core";

export const SPINE_SOURCE = "SPINE";

export type CurationStatus = "ACCEPTED" | "WARNED" | "REJECTED";

export interface CurationResult {
  status: CurationStatus;
  notes: string[];
  employee: CanonicalEmployee | null;
}

/** Trim and collapse internal whitespace; blank becomes null. */
function clean(v: string | null): string | null {
  if (v === null) return null;
  const s = v.replace(/\s+/g, " ").trim();
  return s === "" ? null : s;
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

export type ParsedSpineDate = { kind: "NONE" } | { kind: "INVALID" } | { kind: "DATE"; date: IsoDate };

/** Reads Spine's "2026-03-06T00:00:00" form. Anything else is INVALID, never guessed at. */
export function parseSpineDate(raw: string | null): ParsedSpineDate {
  const v = clean(raw);
  if (v === null) return { kind: "NONE" };
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?)?$/.exec(v);
  if (!m) return { kind: "INVALID" };
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  const check = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(check.getTime()) || check.toISOString().slice(0, 10) !== iso) return { kind: "INVALID" };
  return { kind: "DATE", date: iso };
}

/**
 * For anyone who has not left, Spine fills Last_Working_Date with their projected
 * retirement date (DOB + retirement age): 2027–2064 across the live roster on 2026-10-07,
 * 2079 in the vendor's sample. Confirmed by SIHL 2026-10-06: it means "has not happened yet".
 * Leavers carry their real last working day (all 363 non-Active records on 2026-10-07).
 *
 * Detected by horizon rather than by year: anything more than a year out is a projection.
 * A retirement inside the horizon is kept as a real date — harmless while the status is
 * Active (lifecycle only reviews it once the date has passed and HR has not updated status).
 */
export const PLACEHOLDER_HORIZON_DAYS = 366;

export function isPlaceholderDate(date: IsoDate, today: IsoDate): boolean {
  return date > addDays(today, PLACEHOLDER_HORIZON_DAYS);
}

// ---------------------------------------------------------------------------
// Field curation
// ---------------------------------------------------------------------------

/**
 * Spine's only confirmed value is "Active". Every other non-blank value is treated as not
 * employed; the original label is kept in sourceStatus for the reviewer.
 */
export function spineEmploymentStatus(status: string | null): EmploymentStatus {
  const s = clean(status);
  if (s === null) return "UNKNOWN";
  return s.toLowerCase() === "active" ? "ACTIVE" : "INACTIVE";
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function curateEmail(raw: string | null, notes: string[]): string | null {
  const v = clean(raw);
  if (v === null) return null;
  if (!EMAIL_RE.test(v)) {
    notes.push("Email is not a valid address; not taken");
    return null;
  }
  return v.toLowerCase();
}

/** Digits only; an Indian +91/0 prefix on a 10-digit number is removed. Odd lengths warn. */
function curateMobile(raw: string | null, notes: string[]): string | null {
  const v = clean(raw);
  if (v === null) return null;
  let d = v.replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (d === "") {
    notes.push("Mobile has no digits; not taken");
    return null;
  }
  if (d.length !== 10) notes.push(`Mobile has ${d.length} digits, expected 10`);
  return d;
}

/** Spine Yes/No flags. Anything else is not guessed at: null, with a note. */
export function parseYesNo(raw: string | null, field: string, notes: string[]): boolean | null {
  const v = clean(raw);
  if (v === null) return null;
  const l = v.toLowerCase();
  if (l === "yes" || l === "y") return true;
  if (l === "no" || l === "n") return false;
  notes.push(`${field} is not Yes/No; not taken`);
  return null;
}

/** An optional Spine date: null when absent; null with a note when unreadable. */
function optionalDate(raw: string | null, field: string, notes: string[]): IsoDate | null {
  const d = parseSpineDate(raw);
  if (d.kind === "INVALID") notes.push(`${field} could not be read`);
  return d.kind === "DATE" ? d.date : null;
}

/** The recorded-only details. Nothing here affects employmentStatus or access. */
function curateDetails(raw: SpineRawEmployee, today: IsoDate, notes: string[]): EmployeeDetails {
  // Confirm Date carried the far-future placeholder in the vendor sample (none on the live
  // roster, 2026-10-07): treat it like Last_Working_Date. FnF_Retiring_Date is BY DEFINITION
  // the projected retirement date, so it is kept as sent.
  const confirmation = optionalDate(raw.confirmDate, "Confirm Date", notes);
  return {
    joinDate: optionalDate(raw.joinDate, "Join_Date", notes),
    groupJoinDate: optionalDate(raw.groupJoinDate, "Group_Join_Date", notes),
    confirmationDate: confirmation && !isPlaceholderDate(confirmation, today) ? confirmation : null,
    probationDate: optionalDate(raw.probationDate, "Probation_Date", notes),
    retirementDate: optionalDate(raw.fnfRetiringDate, "FnF_Retiring_Date", notes),
    resignationDate: optionalDate(raw.resignOfferDate, "Resign_Offer_Date", notes),
    leavingReason: clean(raw.reasonForLeaving),
    accountFrozen: parseYesNo(raw.freezeAccount, "Freeze_Account", notes),
    frozenDate: optionalDate(raw.freezeDate, "Freeze_Date", notes),
    frozenReason: clean(raw.freezeReason),
    designation: clean(raw.designation),
    division: clean(raw.division),
    unit: clean(raw.unit),
    grade: clean(raw.grade),
    employeeType: clean(raw.employeeType),
    jobPostCode: clean(raw.jobPostCode),
    project: clean(raw.project),
    isProfessional: parseYesNo(raw.professionalEmployee, "Professional_Employee", notes),
    userGroup: clean(raw.userGroup),
    isInternational: parseYesNo(raw.isInternational, "Is_International", notes),
    educationQualification: clean(raw.educationQualification),
    pfApplicable: parseYesNo(raw.pfFlag, "PF_Flag", notes),
    esicApplicable: parseYesNo(raw.esicFlag, "ESIC_Flag", notes),
    ptApplicable: parseYesNo(raw.ptFlag, "PT_Flag", notes),
    lwfManager: parseYesNo(raw.lwfManager, "LWF_Manager", notes),
    lwfSupervisor: parseYesNo(raw.lwfSupervisor, "LWF_Supervisor", notes),
    attendanceGroup: clean(raw.attendanceGroup),
    leaveGroup: clean(raw.leaveGroup),
    expenseGroup: clean(raw.expenseGroup),
    timesheetGroup: clean(raw.timeSheetGroup),
    pmsGroup: clean(raw.pmsGroup),
    addOnServiceGroup: clean(raw.addOnServiceGroup),
    // Spine has no reporting-manager field yet (raised with the vendor). When it arrives: add
    // it to SPINE_FIELD_MAP and curate it here; nothing downstream changes.
    reportingManagerCode: null,
  };
}

export function curateSpineRecord(raw: SpineRawEmployee, today: IsoDate): CurationResult {
  const notes: string[] = [];
  const code = clean(raw.employeeCode);
  if (code === null) return { status: "REJECTED", notes: ["Missing Employee_Code"], employee: null };

  const oldCode = clean(raw.oldEmployeeCode);
  const lwd = parseSpineDate(raw.lastWorkingDate);
  let lastWorkingDate: IsoDate | null = null;
  if (lwd.kind === "INVALID") notes.push("Last_Working_Date could not be read");
  else if (lwd.kind === "DATE" && !isPlaceholderDate(lwd.date, today)) lastWorkingDate = lwd.date;

  const employee: CanonicalEmployee = {
    sourceSystem: SPINE_SOURCE,
    sourceEmployeeId: code,
    previousSourceEmployeeId: oldCode && oldCode !== code ? oldCode : null,
    sourceCompanyCode: clean(raw.companyCode),
    firstName: clean(raw.firstName),
    lastName: clean(raw.lastName),
    email: curateEmail(raw.email, notes),
    mobile: curateMobile(raw.mobile, notes),
    branch: clean(raw.branch),
    department: clean(raw.department),
    sourceStatus: clean(raw.status),
    employmentStatus: spineEmploymentStatus(raw.status),
    lastWorkingDate,
    lastWorkingDateInvalid: lwd.kind === "INVALID",
    onLeave: null, // Spine's EmployeeService does not report leave.
    details: curateDetails(raw, today, notes),
  };
  if (employee.employmentStatus === "UNKNOWN") notes.push("Status is blank");
  return { status: notes.length ? "WARNED" : "ACCEPTED", notes, employee };
}

// ---------------------------------------------------------------------------
// Batch handling
// ---------------------------------------------------------------------------

/**
 * Positions superseded by a later record for the same employee code. Created and Modified
 * are fetched in that order and concatenated, so the last occurrence is the newest state.
 * Records without a code are never superseded — they are rejected on their own.
 */
export function supersededPositions(codes: (string | null)[]): Set<number> {
  const last = new Map<string, number>();
  codes.forEach((c, i) => {
    const k = clean(c);
    if (k !== null) last.set(k, i);
  });
  const out = new Set<number>();
  codes.forEach((c, i) => {
    const k = clean(c);
    if (k !== null && last.get(k) !== i) out.add(i);
  });
  return out;
}

export interface FieldChange {
  field: string;
  oldValue: string | null;
  newValue: string | null;
}

const show = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

/** Field-level differences between the stored row and the newly curated one. */
export function diffEmployee(prev: CanonicalEmployee, next: CanonicalEmployee): FieldChange[] {
  const out: FieldChange[] = [];
  for (const f of TRACKED_FIELDS) {
    if (show(prev[f]) !== show(next[f])) out.push({ field: f, oldValue: show(prev[f]), newValue: show(next[f]) });
  }
  for (const f of DETAIL_FIELDS) {
    const a = show(prev.details[f]);
    const b = show(next.details[f]);
    if (a !== b) out.push({ field: f, oldValue: a, newValue: b });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Which dates to fetch
// ---------------------------------------------------------------------------

/**
 * Spine's go-live: every record in Spine was created on this date (probed 2026-10-07), so
 * ReqType=Created for it returns the whole roster as it stood then. The initial load is
 * this date, then every day after it.
 */
export const SPINE_INITIAL_LOAD_DATE = "2026-07-10";

/** One invocation never fetches more than this many days; the next run continues. */
export const MAX_DATES_PER_RUN = 120;

/**
 * The Spine dates to fetch, oldest first. ReqDate means "changed on that day", so every day
 * must be fetched once or its changes are lost.
 *
 *   - `from` given: from .. to (an explicit backfill or the initial load).
 *   - otherwise: the day after the last successful date .. to.
 *   - no successful run ever and no `from`: refuse — silently starting at yesterday would
 *     skip the whole roster.
 *
 * `to` defaults to yesterday: today's changes are still happening.
 */
export function planIngestDates(opts: {
  lastSucceeded: IsoDate | null;
  today: IsoDate;
  from?: IsoDate;
  to?: IsoDate;
}): IsoDate[] {
  const to = opts.to ?? addDays(opts.today, -1);
  let from = opts.from;
  if (!from) {
    if (!opts.lastSucceeded) {
      throw new Error(`No successful HR ingest yet: run the initial load with --from ${SPINE_INITIAL_LOAD_DATE}`);
    }
    from = addDays(opts.lastSucceeded, 1);
  }
  if (to >= opts.today) throw new Error(`--to must be before today (${opts.today}); today's changes are incomplete`);
  const out: IsoDate[] = [];
  for (let d = from; d <= to && out.length < MAX_DATES_PER_RUN; d = addDays(d, 1)) out.push(d);
  return out;
}
