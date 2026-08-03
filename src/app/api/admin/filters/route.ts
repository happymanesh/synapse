import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { filterDefinitionSchema } from "@/lib/admin-schemas";
import { adminErrorResponse } from "@/lib/admin-crud";

export async function GET() {
  await requireAdmin();
  const filters = await prisma.filterDefinition.findMany({ orderBy: { filterId: "asc" } });
  return NextResponse.json(filters);
}

export async function POST(request: NextRequest) {
  await requireAdmin();
  try {
    const body = filterDefinitionSchema.parse(await request.json());
    const created = await prisma.filterDefinition.create({ data: body });
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
