import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { bindAndWrapWithOwnership, runBoundQuery } from "@/lib/report-sql";

export async function GET(_request: NextRequest, context: { params: Promise<{ reportId: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  const { reportId } = await context.params;

  const report = await prisma.reportDefinition.findFirst({
    where: { reportId, isActive: true, mode: "FORM" },
    include: { columns: { orderBy: { displayOrder: "asc" } } },
  });
  if (!report) {
    return NextResponse.json({ error: "Form not found." }, { status: 404 });
  }

  try {
    const bound = bindAndWrapWithOwnership(report.queryText, {}, "created_by", session.username);
    const rows = await runBoundQuery(bound);
    return NextResponse.json({
      rows,
      reportTitle: report.reportTitle,
      freezeColumns: report.freezeColumns,
      displayStyle: report.displayStyle,
      footerNote: report.footerNote,
      columns: report.columns,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Unable to load your records." }, { status: 500 });
  }
}
