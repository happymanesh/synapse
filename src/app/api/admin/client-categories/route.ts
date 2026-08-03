import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { clientCategorySchema } from "@/lib/admin-schemas";
import { adminErrorResponse } from "@/lib/admin-crud";

export async function GET() {
  await requireAdmin();
  const categories = await prisma.clientCategoryMaster.findMany({ orderBy: { clientCategoryCode: "asc" } });
  return NextResponse.json(categories);
}

export async function POST(request: NextRequest) {
  await requireAdmin();
  try {
    const body = clientCategorySchema.parse(await request.json());
    const created = await prisma.clientCategoryMaster.create({ data: body });
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
