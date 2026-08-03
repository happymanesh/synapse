import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { appUpdateSchema } from "@/lib/admin-schemas";
import { adminErrorResponse, withFkGuard } from "@/lib/admin-crud";

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await context.params;
  try {
    const body = appUpdateSchema.parse(await request.json());
    const updated = await prisma.appMaster.update({ where: { appCode: id }, data: body });
    return NextResponse.json(updated);
  } catch (err) {
    return adminErrorResponse(err);
  }
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await context.params;
  try {
    await withFkGuard(() => prisma.appMaster.delete({ where: { appCode: id } }));
    return NextResponse.json({ success: true });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
