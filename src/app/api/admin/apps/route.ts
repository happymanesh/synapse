import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { appSchema } from "@/lib/admin-schemas";
import { adminErrorResponse } from "@/lib/admin-crud";

export async function GET() {
  await requireAdmin();
  const apps = await prisma.appMaster.findMany({ orderBy: [{ displayOrder: "asc" }, { appCode: "asc" }] });
  return NextResponse.json(apps);
}

export async function POST(request: NextRequest) {
  await requireAdmin();
  try {
    const body = appSchema.parse(await request.json());
    const created = await prisma.appMaster.create({ data: body });
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
