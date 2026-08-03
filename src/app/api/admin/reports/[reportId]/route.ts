import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { reportDefinitionUpdateSchema } from "@/lib/admin-schemas";
import { adminErrorResponse, withFkGuard } from "@/lib/admin-crud";

export async function PUT(request: NextRequest, context: { params: Promise<{ reportId: string }> }) {
  await requireAdmin();
  const { reportId } = await context.params;
  try {
    const body = reportDefinitionUpdateSchema.parse(await request.json());
    const updated = await prisma.reportDefinition.update({ where: { reportId }, data: body });
    return NextResponse.json(updated);
  } catch (err) {
    return adminErrorResponse(err);
  }
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ reportId: string }> }) {
  await requireAdmin();
  const { reportId } = await context.params;
  try {
    await withFkGuard(() => prisma.reportDefinition.delete({ where: { reportId } }));
    return NextResponse.json({ success: true });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
