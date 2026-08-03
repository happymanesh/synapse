import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { filterDefinitionUpdateSchema } from "@/lib/admin-schemas";
import { adminErrorResponse, withFkGuard } from "@/lib/admin-crud";

export async function PUT(request: NextRequest, context: { params: Promise<{ filterId: string }> }) {
  await requireAdmin();
  const { filterId } = await context.params;
  try {
    const body = filterDefinitionUpdateSchema.parse(await request.json());
    const updated = await prisma.filterDefinition.update({ where: { filterId }, data: body });
    return NextResponse.json(updated);
  } catch (err) {
    return adminErrorResponse(err);
  }
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ filterId: string }> }) {
  await requireAdmin();
  const { filterId } = await context.params;
  try {
    await withFkGuard(() => prisma.filterDefinition.delete({ where: { filterId } }));
    return NextResponse.json({ success: true });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
