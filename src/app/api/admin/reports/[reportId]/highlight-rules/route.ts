import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { reportRowHighlightRuleSchema } from "@/lib/admin-schemas";
import { adminErrorResponse } from "@/lib/admin-crud";

export async function GET(_request: NextRequest, context: { params: Promise<{ reportId: string }> }) {
  await requireAdmin();
  const { reportId } = await context.params;
  const rules = await prisma.reportRowHighlightRule.findMany({ where: { reportId }, orderBy: { priority: "desc" } });
  return NextResponse.json(rules);
}

export async function POST(request: NextRequest, context: { params: Promise<{ reportId: string }> }) {
  await requireAdmin();
  const { reportId } = await context.params;
  try {
    const body = reportRowHighlightRuleSchema.parse(await request.json());
    const created = await prisma.reportRowHighlightRule.create({ data: { ...body, reportId } });
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
