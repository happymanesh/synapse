import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { filterDefinitionItemSchema } from "@/lib/admin-schemas";
import { adminErrorResponse } from "@/lib/admin-crud";

export async function GET(_request: NextRequest, context: { params: Promise<{ filterId: string }> }) {
  await requireAdmin();
  const { filterId } = await context.params;
  const items = await prisma.filterDefinitionItem.findMany({
    where: { filterId },
    orderBy: [{ rowNo: "asc" }, { positionNo: "asc" }],
  });
  return NextResponse.json(items);
}

export async function POST(request: NextRequest, context: { params: Promise<{ filterId: string }> }) {
  await requireAdmin();
  const { filterId } = await context.params;
  try {
    const body = filterDefinitionItemSchema.parse(await request.json());
    const created = await prisma.filterDefinitionItem.create({ data: { ...body, filterId } });
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
