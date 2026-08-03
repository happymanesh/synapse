import "server-only";
import { prisma } from "@/lib/db";

export interface ReportDefinitionView {
  reportId: string;
  reportTitle: string;
  mode: "REPORT" | "FORM";
  isCollapsible: boolean;
  defaultCollapsed: boolean;
  allowedFormats: string[];
  items: {
    id: number;
    componentCode: string;
    rowNo: number;
    positionNo: number;
    isMandatory: boolean;
    labelOverride: string | null;
    defaultValue: string | null;
    dependsOnItemId: number | null;
    mappedColumn: string | null;
    component: {
      componentName: string;
      componentType: string;
      dataSourceType: string;
      staticOptionsJson: string | null;
    };
  }[];
}

/**
 * Assembles a report's filter/items view — the same shape ReportRunner needs
 * whether it's rendered from the report page (server-side) or fetched by
 * DrillDownModal client-side via the /definition API route.
 */
export async function getReportDefinitionView(reportId: string): Promise<ReportDefinitionView | null> {
  const report = await prisma.reportDefinition.findFirst({
    where: { reportId, isActive: true },
    include: {
      filter: {
        include: {
          items: {
            where: { isActive: true },
            include: { component: true },
            orderBy: [{ rowNo: "asc" }, { positionNo: "asc" }],
          },
        },
      },
    },
  });

  if (!report) return null;

  return {
    reportId: report.reportId,
    reportTitle: report.reportTitle,
    mode: report.mode === "FORM" ? "FORM" : "REPORT",
    isCollapsible: report.filter.isCollapsible,
    defaultCollapsed: report.filter.defaultCollapsed,
    allowedFormats: report.allowedFormats,
    items: report.filter.items.map((item) => ({
      id: item.id,
      componentCode: item.componentCode,
      rowNo: item.rowNo,
      positionNo: item.positionNo,
      isMandatory: item.isMandatory,
      labelOverride: item.labelOverride,
      defaultValue: item.defaultValue,
      dependsOnItemId: item.dependsOnItemId,
      mappedColumn: item.mappedColumn,
      component: {
        componentName: item.component.componentName,
        componentType: item.component.componentType,
        dataSourceType: item.component.dataSourceType,
        staticOptionsJson: item.component.staticOptionsJson,
      },
    })),
  };
}
