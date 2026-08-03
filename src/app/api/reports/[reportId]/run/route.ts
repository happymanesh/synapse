import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { buildParamValues, countParameterizedQuery, isFilterValuePresent, runParameterizedQuery } from "@/lib/report-sql";

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

  const paramValues = buildParamValues(
    report.filter.items.map((item) => ({
      componentCode: item.componentCode,
      defaultValue: item.defaultValue,
      componentType: item.component.componentType,
    })),
    values
  );

  try {
    const total = await countParameterizedQuery(report.queryText, paramValues);
    if (total > report.maxRows) {
      return NextResponse.json({
        exceeded: true,
        total,
        maxRows: report.maxRows,
        message: `This report returned ${total} rows, which exceeds the display limit of ${report.maxRows}. Use Export to download the full result instead.`,
      });
    }

    const rows = await runParameterizedQuery(report.queryText, paramValues);
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
