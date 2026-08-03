import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { reportDefinitionSchema } from "@/lib/admin-schemas";
import { adminErrorResponse } from "@/lib/admin-crud";

export async function GET() {
  await requireAdmin();
  const reports = await prisma.reportDefinition.findMany({ orderBy: { reportId: "asc" } });
  return NextResponse.json(reports);
}

export async function POST(request: NextRequest) {
  await requireAdmin();
  try {
    const body = reportDefinitionSchema.parse(await request.json());
    const created = await prisma.reportDefinition.create({ data: body });
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
