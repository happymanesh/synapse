import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { reportColumnSchema } from "@/lib/admin-schemas";
import { adminErrorResponse } from "@/lib/admin-crud";

export async function GET(_request: NextRequest, context: { params: Promise<{ reportId: string }> }) {
  await requireAdmin();
  const { reportId } = await context.params;
  const columns = await prisma.reportColumn.findMany({ where: { reportId }, orderBy: { displayOrder: "asc" } });
  return NextResponse.json(columns);
}

export async function POST(request: NextRequest, context: { params: Promise<{ reportId: string }> }) {
  await requireAdmin();
  const { reportId } = await context.params;
  try {
    const body = reportColumnSchema.parse(await request.json());
    const created = await prisma.reportColumn.create({ data: { ...body, reportId } });
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
