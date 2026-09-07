import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { guardMenu } from "@/lib/api-guard";
import { issueCategoryUpdateSchema, SUPPORT_MENU } from "@/lib/support-schemas";
import { adminErrorResponse, withFkGuard } from "@/lib/admin-crud";

const DENIED = "You don't have access to the issue taxonomy.";

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { error } = await guardMenu(SUPPORT_MENU.CATEGORIES, DENIED);
  if (error) return error;

  const { id } = await context.params;
  try {
    const body = issueCategoryUpdateSchema.parse(await request.json());
    const updated = await prisma.issueCategory.update({ where: { categoryCode: id }, data: body });
    return NextResponse.json(updated);
  } catch (err) {
    return adminErrorResponse(err);
  }
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { error } = await guardMenu(SUPPORT_MENU.CATEGORIES, DENIED);
  if (error) return error;

  const { id } = await context.params;
  try {
    // A category with tickets filed against it is RESTRICT-protected at the database level,
    // so this surfaces as a 409 telling the lead to deactivate instead — the right answer,
    // since deleting it would erase how those tickets were classified.
    await withFkGuard(() => prisma.issueCategory.delete({ where: { categoryCode: id } }));
    return NextResponse.json({ success: true });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
