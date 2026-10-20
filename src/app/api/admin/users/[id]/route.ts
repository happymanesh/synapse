import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { userUpdateSchema } from "@/lib/admin-schemas";
import { adminErrorResponse, withFkGuard } from "@/lib/admin-crud";
import { resolveEmployeeProfile } from "@/lib/user-employee-profile";

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await context.params;
  try {
    const body = userUpdateSchema.parse(await request.json());
    const uid = Number(id);
    const profile = await resolveEmployeeProfile(body, uid);
    if (!profile.ok) return NextResponse.json({ error: profile.error }, { status: profile.status });

    // An unchanged manager keeps its source (an HR-supplied value stays HR); a changed one
    // becomes ADMIN-set — until the HR sync supplies its own.
    const current = await prisma.userDetails.findUnique({
      where: { uid },
      select: { reportingManagerCode: true, reportingManagerSource: true },
    });
    const managerChanged = (current?.reportingManagerCode ?? null) !== profile.data.reportingManagerCode;
    const reportingManagerSource = !profile.data.reportingManagerCode
      ? null
      : managerChanged
        ? "ADMIN"
        : (current?.reportingManagerSource ?? "ADMIN");

    const updated = await prisma.userDetails.update({
      where: { uid },
      data: { ...body, ...profile.data, reportingManagerSource },
    });
    return NextResponse.json(updated);
  } catch (err) {
    return adminErrorResponse(err);
  }
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await context.params;
  try {
    await withFkGuard(() => prisma.userDetails.delete({ where: { uid: Number(id) } }));
    return NextResponse.json({ success: true });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
