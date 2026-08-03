import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { filterDefinitionItemUpdateSchema } from "@/lib/admin-schemas";
import { adminErrorResponse, withFkGuard } from "@/lib/admin-crud";

export async function PUT(request: NextRequest, context: { params: Promise<{ filterId: string; id: string }> }) {
  await requireAdmin();
  const { id } = await context.params;
  try {
    const body = filterDefinitionItemUpdateSchema.parse(await request.json());
    const updated = await prisma.filterDefinitionItem.update({ where: { id: Number(id) }, data: body });
    return NextResponse.json(updated);
  } catch (err) {
    return adminErrorResponse(err);
  }
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ filterId: string; id: string }> }) {
  await requireAdmin();
  const { id } = await context.params;
  try {
    await withFkGuard(() => prisma.filterDefinitionItem.delete({ where: { id: Number(id) } }));
    return NextResponse.json({ success: true });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
