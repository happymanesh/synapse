import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import AdminCrudTable, { type FieldConfig, type ColumnConfig } from "@/components/admin/AdminCrudTable";
import { AdminRowActionsProvider } from "@/components/admin/AdminRowActionsContext";
import ReportRowActions from "@/components/admin/ReportRowActions";

const fields: FieldConfig[] = [
  { name: "reportId", label: "Report ID", type: "text", required: true, hideOnEdit: true },
  { name: "reportTitle", label: "Report Title", type: "text", required: true },
];

const columns: ColumnConfig[] = [
  { key: "reportId", label: "Report ID" },
  { key: "reportTitle", label: "Title" },
  { key: "filterId", label: "Filter" },
  { key: "mode", label: "Mode" },
  { key: "displayStyle", label: "Display" },
  { key: "isActive", label: "Active" },
];

export default async function ReportsAdminPage() {
  const [reports, filters, session] = await Promise.all([
    prisma.reportDefinition.findMany({ orderBy: { reportId: "asc" } }),
    prisma.filterDefinition.findMany({
      where: { isActive: true },
      select: { filterId: true, filterName: true },
      orderBy: { filterId: "asc" },
    }),
    getSession(),
  ]);

  const allFields: FieldConfig[] = [
    ...fields,
    {
      name: "filterId",
      label: "Filter",
      type: "select",
      required: true,
      options: filters.map((f) => ({ value: f.filterId, label: `${f.filterName} (${f.filterId})` })),
    },
    {
      name: "mode",
      label: "Mode",
      type: "select",
      required: true,
      defaultValue: "REPORT",
      options: [
        { value: "REPORT", label: "Report (query + display)" },
        { value: "FORM", label: "Form (add/edit/delete records)" },
      ],
    },
    { name: "queryText", label: "Query (use :componentCode as named params)", type: "textarea", required: true },
    { name: "targetTable", label: "Target table", type: "text", showWhen: { field: "mode", equals: "FORM" } },
    { name: "maxRows", label: "Max rows before forcing export", type: "number", defaultValue: 2000 },
    { name: "freezeColumns", label: "Freeze columns from left", type: "number", defaultValue: 0 },
    {
      name: "displayStyle",
      label: "Display style",
      type: "select",
      defaultValue: "PAGED",
      options: [
        { value: "PAGED", label: "Paged" },
        { value: "FULL_FROZEN", label: "Full width, frozen header/footer" },
      ],
    },
    { name: "footerNote", label: "Static footer note", type: "textarea" },
    { name: "allowedFormats", label: "Allowed export formats (comma-separated, e.g. CSV)", type: "text", defaultValue: "CSV" },
    { name: "allowedDeliveries", label: "Allowed deliveries (comma-separated, e.g. DOWNLOAD)", type: "text", defaultValue: "DOWNLOAD" },
    { name: "isActive", label: "Active", type: "checkbox", defaultValue: true },
  ];

  const reportOptions = reports.map((r) => ({ value: r.reportId, label: `${r.reportTitle} (${r.reportId})` }));

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-foreground">Report Definitions</h1>
      <p className="mb-4 text-sm text-foreground/60">
        Maps a FilterID to a query and display/export configuration. REPORT mode runs and displays the query; FORM
        mode uses the same filter as an add/edit form and lists the current user&apos;s own saved records below it.
      </p>
      <AdminRowActionsProvider value={{ currentUsername: session!.username, reportOptions }}>
        <AdminCrudTable
          apiBasePath="/api/admin/reports"
          idField="reportId"
          columns={columns}
          fields={allFields}
          initialData={reports}
          currentUsername={session!.username}
          RowActions={ReportRowActions}
          compactActions
        />
      </AdminRowActionsProvider>
    </div>
  );
}
