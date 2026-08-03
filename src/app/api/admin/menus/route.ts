import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { menuSchema } from "@/lib/admin-schemas";
import { adminErrorResponse } from "@/lib/admin-crud";

export async function GET() {
  await requireAdmin();
  const menus = await prisma.menuMaster.findMany({ orderBy: [{ level: "asc" }, { displayOrder: "asc" }] });
  return NextResponse.json(menus);
}

export async function POST(request: NextRequest) {
  await requireAdmin();
  try {
    const body = menuSchema.parse(await request.json());
    const created = await prisma.menuMaster.create({ data: { ...body, parentMenuCode: body.parentMenuCode || null } });
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
