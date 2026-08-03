import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { companySchema } from "@/lib/admin-schemas";
import { adminErrorResponse } from "@/lib/admin-crud";

export async function GET() {
  await requireAdmin();
  const companies = await prisma.companyMaster.findMany({ orderBy: { companyCode: "asc" } });
  return NextResponse.json(companies);
}

export async function POST(request: NextRequest) {
  await requireAdmin();
  try {
    const body = companySchema.parse(await request.json());
    const created = await prisma.companyMaster.create({ data: body });
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
