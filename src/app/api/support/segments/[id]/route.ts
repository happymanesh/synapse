import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { guardMenu } from "@/lib/api-guard";
import { masterListUpdateSchema } from "@/lib/ticket-schemas";
import { SUPPORT_MENU } from "@/lib/support-schemas";
import { adminErrorResponse, withFkGuard } from "@/lib/admin-crud";

const DENIED = "You don't have access to the segment list.";

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { error } = await guardMenu(SUPPORT_MENU.SEGMENTS, DENIED);
  if (error) return error;
  const { id } = await context.params;
  try {
    const body = masterListUpdateSchema.parse(await request.json());
    const updated = await prisma.segmentMaster.update({ where: { id: Number(id) }, data: body });
    return NextResponse.json(updated);
  } catch (err) {
    return adminErrorResponse(err);
  }
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { error } = await guardMenu(SUPPORT_MENU.SEGMENTS, DENIED);
  if (error) return error;
  const { id } = await context.params;
  try {
    // Tickets reference this by RESTRICT, so one already in use surfaces as a 409 telling
    // the lead to deactivate instead — deleting would erase how those tickets were classified.
    await withFkGuard(() => prisma.segmentMaster.delete({ where: { id: Number(id) } }));
    return NextResponse.json({ success: true });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
