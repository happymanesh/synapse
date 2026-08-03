import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { filterComponentSchema } from "@/lib/admin-schemas";
import { adminErrorResponse } from "@/lib/admin-crud";

export async function GET() {
  await requireAdmin();
  const components = await prisma.filterComponentMaster.findMany({ orderBy: { componentCode: "asc" } });
  return NextResponse.json(components);
}

export async function POST(request: NextRequest) {
  await requireAdmin();
  try {
    const body = filterComponentSchema.parse(await request.json());
    const created = await prisma.filterComponentMaster.create({ data: body });
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
