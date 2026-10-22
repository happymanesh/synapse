import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { hrMappingSchema } from "@/lib/admin-schemas";
import { adminErrorResponse } from "@/lib/admin-crud";

/** Administration > HR Mapping: which Synapse hierarchy an HR branch/department's new joiners get. */
export async function GET() {
  await requireAdmin();
  const rows = await prisma.hrBranchHierarchyMap.findMany({ orderBy: [{ hrCompanyCode: "asc" }, { hrBranch: "asc" }, { hrDepartment: "asc" }] });
  return NextResponse.json(rows);
}

export async function POST(request: NextRequest) {
  const session = await requireAdmin();
  try {
    const body = hrMappingSchema.parse(await request.json());
    const created = await prisma.hrBranchHierarchyMap.create({
      data: { ...body, hrDepartment: body.hrDepartment ?? null, createdBy: session.username },
    });
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
