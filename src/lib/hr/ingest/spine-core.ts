/**
 * Spine HR adapter: which fields are taken from a Spine record, how the response is
 * unwrapped, and how Spine errors are made safe to log. Pure; no Prisma, no `server-only`.
 *
 * Everything Spine-specific about *meaning* (status vocabulary, placeholder dates, Yes/No) lives
 * in curate-core.ts. This module only lands data.
 */

/**
 * The only Spine fields Synapse ever stores — even in the raw landing table — keyed by the
 * name they land under. The payload carries 129; everything not listed here is dropped in
 * memory, immediately after the response is parsed, before anything is logged or written.
 *
 * Never added (decided 2026-10-07, DPDP Act 2023): personal and family details (caste,
 * religion, gender, birth, parents, spouse, children, photo, body measurements), disability,
 * government IDs (Aadhaar/PAN names, voter, ration, NPR, UAN, PRAN, PF/ESIC numbers), bank,
 * salary and tax, addresses, and personal contacts. Also not taken: Middle_Name, Title,
 * AKA_Name, Remarks, Personal_Remark, the PF/ESIC registration details, CreatedOn/LastModifyOn.
 */
export const SPINE_FIELD_MAP = {
  // Identity and contact (11, the original set)
  employeeCode: "Employee_Code",
  oldEmployeeCode: "Old_Employee_Code",
  companyCode: "Company_Code",
  firstName: "First_Name",
  lastName: "Last_Name",
  email: "Email",
  mobile: "Mobile",
  branch: "Branch",
  department: "Department",
  status: "Status",
  lastWorkingDate: "Last_Working_Date",
  // Employment dates and exit (10)
  joinDate: "Join_Date",
  groupJoinDate: "Group_Join_Date",
  confirmDate: "Confirm Date", // sic: Spine uses a space here, underscores everywhere else
  probationDate: "Probation_Date",
  fnfRetiringDate: "FnF_Retiring_Date",
  resignOfferDate: "Resign_Offer_Date",
  reasonForLeaving: "Reason_For_Leaving", // free text — HR/admin visibility only
  freezeAccount: "Freeze_Account",
  freezeDate: "Freeze_Date",
  freezeReason: "Freeze_Reason", // free text — HR/admin visibility only
  // Job and organisation (11)
  designation: "Designation",
  division: "Division",
  unit: "Unit",
  grade: "Grade",
  employeeType: "Employee_Type",
  jobPostCode: "Job_Post_Code",
  project: "Project",
  professionalEmployee: "Professional_Employee",
  userGroup: "User_Group",
  isInternational: "Is_International",
  educationQualification: "Education_Qualification",
  // Statutory applicability — Yes/No flags only, no registration numbers (5)
  pfFlag: "PF_Flag",
  esicFlag: "ESIC_Flag",
  ptFlag: "PT_Flag",
  lwfManager: "LWF_Manager", // Labour Welfare Fund flag — NOT a reporting manager
  lwfSupervisor: "LWF_Supervisor", // Labour Welfare Fund flag — NOT a person
  // HR administration groups (6)
  attendanceGroup: "Attendance_Group",
  leaveGroup: "Leave_Group",
  expenseGroup: "Expense_Group",
  timeSheetGroup: "Time_Sheet_Group",
  pmsGroup: "PMS_Group",
  addOnServiceGroup: "Add_On_Service_Group",
} as const;

export const SPINE_FIELDS = Object.values(SPINE_FIELD_MAP);

/** One Spine record reduced to the synced fields, values exactly as sent (only coerced to text). */
export type SpineRawEmployee = { [K in keyof typeof SPINE_FIELD_MAP]: string | null };

const asText = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

/**
 * Reduce a raw Spine record to the synced fields. No trimming or validation — that is
 * curation's job, and the raw table must show what Spine actually sent. A non-object becomes an
 * all-null row so it is still landed, and rejected visibly, rather than silently dropped.
 */
export function pickSpineFields(raw: unknown): SpineRawEmployee {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return Object.fromEntries(
    Object.entries(SPINE_FIELD_MAP).map(([key, spineName]) => [key, asText(r[spineName])]),
  ) as SpineRawEmployee;
}

/**
 * The employee list out of a parsed EmployeeService response. Spine's example returns a bare
 * array; the endpoint can also wrap it ({isSuccess, data}). Accept both, reject the rest.
 */
export function extractEmployeeRecords(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    if (b.isSuccess === false) {
      throw new SpineApiError(String(b.statusCode ?? ""), String(b.msg ?? ""));
    }
    if (Array.isArray(b.data)) return b.data;
    if (b.data === null || b.data === undefined) return [];
  }
  throw new SpineApiError("SHAPE", "Unexpected EmployeeService response shape");
}

/**
 * Spine's error messages echo credentials back: a failed token call returns
 * "... Your Key : <the client key>". Strip anything key-shaped before an error is thrown,
 * logged or stored.
 */
export function sanitizeSpineMessage(msg: string): string {
  return msg
    .replace(/<[^>]*>/g, " ")
    .replace(/your\s*key\s*:?\s*\S+/gi, "Your Key : [redacted]")
    .replace(/\b[0-9a-f]{24,}\b/gi, "[redacted]")
    .replace(/\b(bearer\s+)\S+/gi, "$1[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

export class SpineApiError extends Error {
  constructor(
    public readonly statusCode: string,
    message: string,
  ) {
    super(`Spine ${statusCode || "error"}: ${sanitizeSpineMessage(message)}`);
    this.name = "SpineApiError";
  }
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Spine's ReqDate query format: dd-MMM-yyyy, e.g. 06-Oct-2026. */
export function formatReqDate(d: string): string {
  const [y, m, day] = d.split("-");
  return `${day}-${MONTHS[Number(m) - 1]}-${y}`;
}
