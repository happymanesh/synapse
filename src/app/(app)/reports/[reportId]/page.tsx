import { notFound } from "next/navigation";
import { getReportDefinitionView } from "@/lib/report-definition";
import { getMenuForUser, findBreadcrumb } from "@/lib/menu";
import { getSession } from "@/lib/session";
import ReportRunner from "@/components/reports/ReportRunner";

export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ reportId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { reportId } = await params;
  const query = await searchParams;

  const view = await getReportDefinitionView(reportId);
  if (!view) {
    notFound();
  }

  // Breadcrumb reflects this report's actual position in the current user's menu
  // tree (e.g. "Utilities › Sample › Sales Report") — null for a report that's only
  // ever reached via drill-down and has no menu entry of its own (e.g. Sales Detail).
  const session = await getSession();
  const menuTree = session ? await getMenuForUser(session.userUid) : [];
  const breadcrumb = findBreadcrumb(menuTree, `/reports/${reportId}`);

  // Drill-down landing: any query param matching one of this report's own filter
  // componentCodes is treated as an initial value (unrecognized keys, e.g. a
  // summary report's own filter codes, are ignored) — this is what lets a
  // parent report's filter values "carry over" without any explicit mapping.
  const knownCodes = new Set(view.items.map((item) => item.componentCode));
  const initialValues: Record<string, string> = {};
  for (const [key, value] of Object.entries(query)) {
    if (knownCodes.has(key) && typeof value === "string") {
      initialValues[key] = value;
    }
  }

  const drillFrom = typeof query.drillFrom === "string" ? query.drillFrom : undefined;
  const drillFromTitle = typeof query.drillFromTitle === "string" ? query.drillFromTitle : undefined;

  return (
    <ReportRunner
      reportId={view.reportId}
      reportTitle={view.reportTitle}
      mode={view.mode}
      isCollapsible={view.isCollapsible}
      defaultCollapsed={view.defaultCollapsed}
      items={view.items}
      allowedFormats={view.allowedFormats}
      initialValues={Object.keys(initialValues).length > 0 ? initialValues : undefined}
      autoShow={Object.keys(initialValues).length > 0}
      backLink={drillFrom ? { label: drillFromTitle ?? drillFrom } : undefined}
      breadcrumb={breadcrumb ?? undefined}
    />
  );
}
