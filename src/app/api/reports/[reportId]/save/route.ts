import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { buildInsertQuery, buildOwnedUpdateQuery, isFilterValuePresent, runWriteQuery } from "@/lib/report-sql";

/**
 * FORM-mode target tables are expected to have created_by/updated_by/updated_on
 * columns (see CLAUDE.md "User-owned records" rule) — the engine sets these
 * itself rather than trusting the submitted form values.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ reportId: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  const { reportId } = await context.params;

  const report = await prisma.reportDefinition.findFirst({
    where: { reportId, isActive: true, mode: "FORM" },
    include: {
      filter: { include: { items: { where: { isActive: true }, include: { component: true } } } },
      columns: true,
    },
  });
  if (!report || !report.targetTable) {
    return NextResponse.json({ error: "Form not found." }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const values: Record<string, unknown> = body?.values ?? {};
  const recordId = body?.recordId as string | number | undefined;

  const missing = report.filter.items.filter(
    (item) => item.isMandatory && !isFilterValuePresent(item.component.componentType, values[item.componentCode])
  );
  if (missing.length > 0) {
    return NextResponse.json(
      {
        error: `Missing required field(s): ${missing.map((m) => m.labelOverride ?? m.component.componentName).join(", ")}`,
      },
      { status: 400 }
    );
  }

  const columnValues: Record<string, unknown> = {};
  for (const item of report.filter.items) {
    if (item.mappedColumn) {
      columnValues[item.mappedColumn] = values[item.componentCode] ?? null;
    }
  }

  const identifierColumn = report.columns.find((c) => c.isIdentifier)?.columnKey ?? "id";

  try {
    if (recordId !== undefined && recordId !== null && recordId !== "") {
      const bound = buildOwnedUpdateQuery(report.targetTable, identifierColumn, recordId, "created_by", session.username, {
        ...columnValues,
        updated_by: session.username,
        updated_on: new Date(),
      });
      const rows = await runWriteQuery(bound);
      if (rows.length === 0) {
        return NextResponse.json({ error: "Record not found, or you don't have permission to edit it." }, { status: 403 });
      }
      return NextResponse.json(rows[0]);
    }

    const bound = buildInsertQuery(report.targetTable, {
      ...columnValues,
      created_by: session.username,
      updated_by: session.username,
      updated_on: new Date(),
    });
    const rows = await runWriteQuery(bound);
    return NextResponse.json(rows[0], { status: 201 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Unable to save this record." }, { status: 500 });
  }
}
