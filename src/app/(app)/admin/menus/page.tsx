import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import AdminCrudTable, { type FieldConfig, type ColumnConfig } from "@/components/admin/AdminCrudTable";

export default async function MenusAdminPage() {
  const [menus, companies, hierarchies, reports, apps, session] = await Promise.all([
    prisma.menuMaster.findMany({ orderBy: [{ level: "asc" }, { displayOrder: "asc" }] }),
    prisma.companyMaster.findMany({ select: { companyCode: true, companyName: true }, orderBy: { companyCode: "asc" } }),
    prisma.hierarchyMaster.findMany({ select: { hierarchyCode: true, hierarchyName: true }, orderBy: { seqId: "asc" } }),
    prisma.reportDefinition.findMany({
      where: { isActive: true },
      select: { reportId: true, reportTitle: true },
      orderBy: { reportId: "asc" },
    }),
    prisma.appMaster.findMany({
      where: { isActive: true },
      select: { appCode: true, appName: true },
      orderBy: [{ displayOrder: "asc" }, { appCode: "asc" }],
    }),
    getSession(),
  ]);

  const fields: FieldConfig[] = [
    { name: "menuCode", label: "Menu Code", type: "text", required: true, hideOnEdit: true },
    {
      name: "appCode",
      label: "App (leave blank to show this menu in every app)",
      type: "select",
      options: apps.map((a) => ({ value: a.appCode, label: `${a.appName} (${a.appCode})` })),
    },
    {
      name: "parentMenuCode",
      label: "Parent Menu (leave blank for top-level)",
      type: "select",
      options: menus.map((m) => ({ value: m.menuCode, label: `${m.menuName} (${m.menuCode})` })),
    },
    { name: "menuName", label: "Menu Name", type: "text", required: true },
    { name: "icon", label: "Icon (e.g. an emoji)", type: "text" },
    {
      name: "menuType",
      label: "Type",
      type: "select",
      required: true,
      defaultValue: "ROUTE",
      options: [
        { value: "ROUTE", label: "Internal route" },
        { value: "REPORT", label: "Report" },
        { value: "EXTERNAL", label: "External URL" },
      ],
    },
    { name: "routePath", label: "Route Path", type: "text", showWhen: { field: "menuType", equals: "ROUTE" } },
    {
      name: "reportId",
      label: "Report",
      type: "select",
      showWhen: { field: "menuType", equals: "REPORT" },
      options: reports.map((r) => ({ value: r.reportId, label: `${r.reportTitle} (${r.reportId})` })),
    },
    { name: "externalUrl", label: "External URL", type: "text", showWhen: { field: "menuType", equals: "EXTERNAL" } },
    {
      name: "level",
      label: "Level",
      type: "select",
      required: true,
      options: [
        { value: "1", label: "1 — Main" },
        { value: "2", label: "2 — Sub" },
        { value: "3", label: "3 — Option" },
      ],
    },
    { name: "displayOrder", label: "Display Order", type: "number", required: true, defaultValue: 0 },
    {
      name: "companyCode",
      label: "Company",
      type: "select",
      required: true,
      options: companies.map((c) => ({ value: c.companyCode, label: c.companyName })),
    },
    {
      name: "hierarchyCode",
      label: "Hierarchy",
      type: "select",
      required: true,
      options: hierarchies.map((h) => ({ value: h.hierarchyCode, label: h.hierarchyName })),
    },
    { name: "isActive", label: "Active", type: "checkbox", defaultValue: true },
  ];

  const columns: ColumnConfig[] = [
    { key: "menuCode", label: "Code" },
    { key: "menuName", label: "Name" },
    { key: "appCode", label: "App" },
    { key: "level", label: "Level" },
    { key: "menuType", label: "Type" },
    { key: "parentMenuCode", label: "Parent" },
    { key: "companyCode", label: "Company" },
    { key: "hierarchyCode", label: "Hierarchy" },
    { key: "isActive", label: "Active" },
  ];

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-foreground">Menu Master</h1>
      <AdminCrudTable
        apiBasePath="/api/admin/menus"
        idField="menuCode"
        columns={columns}
        fields={fields}
        initialData={menus}
        currentUsername={session!.username}
        compactActions
        companyFilterOptions={companies.map((c) => ({ value: c.companyCode, label: c.companyName }))}
      />
    </div>
  );
}
