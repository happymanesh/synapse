import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getReportDefinitionView } from "@/lib/report-definition";

/** Lets DrillDownModal fetch a target report's filter/items client-side without a full page navigation. */
export async function GET(_request: Request, context: { params: Promise<{ reportId: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  const { reportId } = await context.params;

  const view = await getReportDefinitionView(reportId);
  if (!view) {
    return NextResponse.json({ error: "Report not found." }, { status: 404 });
  }

  return NextResponse.json(view);
}
