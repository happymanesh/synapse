import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { guardMenu } from "@/lib/api-guard";
import { issueCategorySchema, SUPPORT_MENU } from "@/lib/support-schemas";
import { adminErrorResponse } from "@/lib/admin-crud";

/**
 * Issue taxonomy CRUD (BRS §4.3). Owned by the support lead, not an administrator, so these
 * routes gate on the SUP_CATEGORIES menu grant rather than requireAdmin().
 */
const DENIED = "You don't have access to the issue taxonomy.";

export async function GET() {
  const { error } = await guardMenu(SUPPORT_MENU.CATEGORIES, DENIED);
  if (error) return error;

  const categories = await prisma.issueCategory.findMany({
    orderBy: [{ displayOrder: "asc" }, { categoryName: "asc" }],
  });
  return NextResponse.json(categories);
}

export async function POST(request: NextRequest) {
  const { error } = await guardMenu(SUPPORT_MENU.CATEGORIES, DENIED);
  if (error) return error;

  try {
    const body = issueCategorySchema.parse(await request.json());
    const created = await prisma.issueCategory.create({ data: body });
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
