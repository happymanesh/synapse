import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { hierarchySchema } from "@/lib/admin-schemas";
import { adminErrorResponse } from "@/lib/admin-crud";

export async function GET() {
  await requireAdmin();
  const hierarchies = await prisma.hierarchyMaster.findMany({ orderBy: { seqId: "asc" } });
  return NextResponse.json(hierarchies);
}

export async function POST(request: NextRequest) {
  await requireAdmin();
  try {
    const body = hierarchySchema.parse(await request.json());
    const created = await prisma.hierarchyMaster.create({ data: body });
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
