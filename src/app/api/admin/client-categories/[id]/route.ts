import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { clientCategoryUpdateSchema } from "@/lib/admin-schemas";
import { adminErrorResponse, withFkGuard } from "@/lib/admin-crud";

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await context.params;
  try {
    const body = clientCategoryUpdateSchema.parse(await request.json());
    const updated = await prisma.clientCategoryMaster.update({ where: { clientCategoryCode: id }, data: body });
    return NextResponse.json(updated);
  } catch (err) {
    return adminErrorResponse(err);
  }
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await context.params;
  try {
    await withFkGuard(() => prisma.clientCategoryMaster.delete({ where: { clientCategoryCode: id } }));
    return NextResponse.json({ success: true });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
