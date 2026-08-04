import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import {
  applyCompanyScope,
  bindReportTemplate,
  buildParamValues,
  isFilterValuePresent,
  runBoundQuery,
  withSessionParams,
} from "@/lib/report-sql";
import { prismaReadOnly } from "@/lib/db";

export async function POST(request: NextRequest, context: { params: Promise<{ reportId: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  const { reportId } = await context.params;

  const report = await prisma.reportDefinition.findFirst({
    where: { reportId, isActive: true, mode: "REPORT" },
    include: {
      filter: { include: { items: { where: { isActive: true }, include: { component: true } } } },
      columns: { orderBy: { displayOrder: "asc" } },
      highlightRules: true,
    },
  });
  if (!report) {
    return NextResponse.json({ error: "Report not found." }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const values: Record<string, unknown> = body?.values ?? {};

  const missing = report.filter.items.filter(
    (item) => item.isMandatory && !isFilterValuePresent(item.component.componentType, values[item.componentCode])
  );
  if (missing.length > 0) {
    return NextResponse.json(
      {
        error: `Missing required filter(s): ${missing.map((m) => m.labelOverride ?? m.component.componentName).join(", ")}`,
      },
      { status: 400 }
    );
  }

  // Reserved SESSION_* params are overlaid last, so a filter component sharing one of those
  // names can never let a caller present themselves as another company or user.
  const paramValues = withSessionParams(
    buildParamValues(
      report.filter.items.map((item) => ({
        componentCode: item.componentCode,
        defaultValue: item.defaultValue,
        componentType: item.component.componentType,
      })),
      values
    ),
    session
  );

  try {
    // bindReportTemplate proves the query is read-only; applyCompanyScope adds the company
    // predicate when the report opts into it, so scoping does not rely on the query author.
    const scoped = applyCompanyScope(
      bindReportTemplate(report.queryText, paramValues),
      report.companyScopeColumn,
      session
    );

    const countResult = await prismaReadOnly.$queryRawUnsafe<{ count: number }[]>(
      `SELECT COUNT(*)::int AS count FROM (${scoped.sql}) __count_wrapper`,
      ...scoped.params
    );
    const total = countResult[0]?.count ?? 0;
    if (total > report.maxRows) {
      return NextResponse.json({
        exceeded: true,
        total,
        maxRows: report.maxRows,
        message: `This report returned ${total} rows, which exceeds the display limit of ${report.maxRows}. Use Export to download the full result instead.`,
      });
    }

    const rows = await runBoundQuery(scoped);
    return NextResponse.json({
      exceeded: false,
      rows,
      total,
      reportTitle: report.reportTitle,
      freezeColumns: report.freezeColumns,
      displayStyle: report.displayStyle,
      footerNote: report.footerNote,
      columns: report.columns,
      highlightRules: report.highlightRules,
      allowedFormats: report.allowedFormats,
      allowedDeliveries: report.allowedDeliveries,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Unable to run this report. Check the report's query configuration." },
      { status: 500 }
    );
  }
}
