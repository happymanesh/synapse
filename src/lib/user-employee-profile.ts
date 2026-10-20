import "server-only";
import { prisma } from "@/lib/db";

/**
 * Server-side checks for the employee fields on a Synapse user (User Master create/edit).
 *
 * employee_code is the key workPulse links users to employees by, so it must be unique —
 * case-insensitively, as usernames are. The reporting manager is stored as the manager's
 * employee code and must name someone who exists (a Synapse user or an HR employee), never
 * the user themself.
 *
 * Creating or editing a user with an employee code that matches an HR record also links the
 * two (user_details.hr_employee_id), so the HR lifecycle — leaver deactivation, freeze — covers
 * that user from then on. Never steals a link: an HR record already linked to someone else is
 * left alone.
 */

export interface EmployeeProfileInput {
  employeeCode: string;
  designation?: string | null;
  department?: string | null;
  reportingManagerCode?: string | null;
}

export type EmployeeProfileResult =
  | {
      ok: true;
      data: {
        employeeCode: string;
        designation: string | null;
        department: string | null;
        reportingManagerCode: string | null;
        hrEmployeeId?: number;
      };
    }
  | { ok: false; status: number; error: string };

const blankToNull = (v: string | null | undefined) => {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
};

export async function resolveEmployeeProfile(input: EmployeeProfileInput, selfUid?: number): Promise<EmployeeProfileResult> {
  const employeeCode = input.employeeCode.trim();
  if (!employeeCode) return { ok: false, status: 400, error: "Employee code is required." };

  const clash = await prisma.userDetails.findFirst({
    where: {
      employeeCode: { equals: employeeCode, mode: "insensitive" },
      ...(selfUid ? { NOT: { uid: selfUid } } : {}),
    },
    select: { username: true },
  });
  if (clash) {
    return { ok: false, status: 409, error: `Employee code ${employeeCode} is already used by ${clash.username}.` };
  }

  const reportingManagerCode = blankToNull(input.reportingManagerCode);
  if (reportingManagerCode) {
    if (reportingManagerCode.toLowerCase() === employeeCode.toLowerCase()) {
      return { ok: false, status: 400, error: "A user cannot be their own reporting manager." };
    }
    const [asUser, asEmployee] = await Promise.all([
      prisma.userDetails.findFirst({
        where: { employeeCode: { equals: reportingManagerCode, mode: "insensitive" } },
        select: { uid: true },
      }),
      prisma.hrEmployee.findFirst({
        where: { sourceEmployeeId: { equals: reportingManagerCode, mode: "insensitive" } },
        select: { id: true },
      }),
    ]);
    if (!asUser && !asEmployee) {
      return { ok: false, status: 400, error: `Reporting manager ${reportingManagerCode} is not a known employee code.` };
    }
  }

  // Link to the HR record with this code, if there is one and nobody else holds it.
  const hr = await prisma.hrEmployee.findFirst({
    where: { sourceEmployeeId: { equals: employeeCode, mode: "insensitive" } },
    select: { id: true, user: { select: { uid: true } } },
  });
  const hrEmployeeId = hr && (!hr.user || hr.user.uid === selfUid) ? hr.id : undefined;

  return {
    ok: true,
    data: {
      employeeCode,
      designation: blankToNull(input.designation),
      department: blankToNull(input.department),
      reportingManagerCode,
      ...(hrEmployeeId !== undefined ? { hrEmployeeId } : {}),
    },
  };
}
