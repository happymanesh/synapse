import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { ipMappingUpdateSchema } from "@/lib/admin-schemas";
import { adminErrorResponse, withFkGuard } from "@/lib/admin-crud";

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await context.params;
  try {
    const body = ipMappingUpdateSchema.parse(await request.json());
    const updated = await prisma.userIpMapping.update({
      where: { id: Number(id) },
      data: body,
      include: { user: { select: { username: true, fullName: true } } },
    });
    return NextResponse.json({
      id: updated.id,
      userUid: updated.userUid,
      username: `${updated.user.username} (${updated.user.fullName})`,
      ipMapping: updated.ipMapping,
      isActive: updated.isActive,
    });
  } catch (err) {
    return adminErrorResponse(err);
  }
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await context.params;
  try {
    await withFkGuard(() => prisma.userIpMapping.delete({ where: { id: Number(id) } }));
    return NextResponse.json({ success: true });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
