import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { notificationUpdateSchema } from "@/lib/admin-schemas";
import { adminErrorResponse } from "@/lib/admin-crud";

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await context.params;
  try {
    const body = notificationUpdateSchema.parse(await request.json());
    const updated = await prisma.notification.update({ where: { id: Number(id) }, data: body });
    return NextResponse.json(updated);
  } catch (err) {
    return adminErrorResponse(err);
  }
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await context.params;
  try {
    await prisma.notification.delete({ where: { id: Number(id) } });
    return NextResponse.json({ success: true });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
