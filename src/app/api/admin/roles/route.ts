import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { roleSchema } from "@/lib/admin-schemas";
import { adminErrorResponse } from "@/lib/admin-crud";

export async function GET() {
  await requireAdmin();
  const roles = await prisma.roleMaster.findMany({ orderBy: { roleCode: "asc" } });
  return NextResponse.json(roles);
}

export async function POST(request: NextRequest) {
  await requireAdmin();
  try {
    const body = roleSchema.parse(await request.json());
    const created = await prisma.roleMaster.create({ data: body });
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
