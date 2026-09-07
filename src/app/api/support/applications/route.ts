import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { guardMenu } from "@/lib/api-guard";
import { masterListSchema } from "@/lib/ticket-schemas";
import { SUPPORT_MENU } from "@/lib/support-schemas";
import { adminErrorResponse } from "@/lib/admin-crud";

/** Application master (see BRS §4.3). Owned by the support lead, so gated on the menu grant
 * rather than requireAdmin(). */
const DENIED = "You don't have access to the application list.";

export async function GET() {
  const { error } = await guardMenu(SUPPORT_MENU.APPLICATIONS, DENIED);
  if (error) return error;
  const rows = await prisma.applicationMaster.findMany({ orderBy: [{ displayOrder: "asc" }, { name: "asc" }] });
  return NextResponse.json(rows);
}

export async function POST(request: NextRequest) {
  const { session, error } = await guardMenu(SUPPORT_MENU.APPLICATIONS, DENIED);
  if (error) return error;
  try {
    const body = masterListSchema.parse(await request.json());
    const created = await prisma.applicationMaster.create({ data: { ...body, createdBy: session.username } });
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
