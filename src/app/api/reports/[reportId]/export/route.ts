import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { buildParamValues, runParameterizedQuery } from "@/lib/report-sql";
import { csvEscape, formatCsvValue } from "@/lib/csv";
import { buildDownloadFilename } from "@/lib/download";

export async function GET(request: NextRequest, context: { params: Promise<{ reportId: string }> }) {
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
    },
  });
  if (!report) {
    return NextResponse.json({ error: "Report not found." }, { status: 404 });
  }
  if (!report.allowedFormats.includes("CSV")) {
    return NextResponse.json({ error: "CSV export isn't enabled for this report." }, { status: 400 });
  }

  let values: Record<string, unknown> = {};
  const raw = request.nextUrl.searchParams.get("values");
  if (raw) {
    try {
      values = JSON.parse(raw);
    } catch {
      // ignore malformed input, fall back to defaults below
    }
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
    const rows = await runParameterizedQuery<Record<string, unknown>>(report.queryText, paramValues);
    const columns =
      report.columns.length > 0
        ? report.columns
        : rows[0]
          ? Object.keys(rows[0]).map((k, i) => ({ columnKey: k, displayLabel: k, displayOrder: i }))
          : [];

    const header = columns.map((c) => c.displayLabel);
    const body = rows.map((row) => columns.map((c) => formatCsvValue(row[c.columnKey])));
    const csv = [header, ...body].map((line) => line.map(csvEscape).join(",")).join("\r\n");

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${buildDownloadFilename(session.username, "csv")}"`,
      },
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Unable to export this report." }, { status: 500 });
  }
}
