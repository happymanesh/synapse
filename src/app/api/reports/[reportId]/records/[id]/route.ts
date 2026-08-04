import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { buildOwnedDeleteQuery, runWriteQuery } from "@/lib/report-sql";

export async function DELETE(_request: NextRequest, context: { params: Promise<{ reportId: string; id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  const { reportId, id } = await context.params;

  const report = await prisma.reportDefinition.findFirst({
    where: { reportId, isActive: true, mode: "FORM" },
    include: { columns: true },
  });
  if (!report || !report.targetTable) {
    return NextResponse.json({ error: "Form not found." }, { status: 404 });
  }

  const identifierColumn = report.columns.find((c) => c.isIdentifier)?.columnKey ?? "id";

  try {
    const bound = buildOwnedDeleteQuery(report.targetTable, identifierColumn, id, "created_by", session.username);
    const rows = await runWriteQuery(bound);
    if (rows.length === 0) {
      return NextResponse.json({ error: "Record not found, or you don't have permission to delete it." }, { status: 403 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Unable to delete this record." }, { status: 500 });
  }
}
