import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import AdminCrudTable, { type FieldConfig, type ColumnConfig } from "@/components/admin/AdminCrudTable";

export default async function AppsAdminPage() {
  const [apps, companies, session] = await Promise.all([
    prisma.appMaster.findMany({ orderBy: [{ displayOrder: "asc" }, { appCode: "asc" }] }),
    prisma.companyMaster.findMany({ select: { companyCode: true, companyName: true }, orderBy: { companyCode: "asc" } }),
    getSession(),
  ]);

  const fields: FieldConfig[] = [
    { name: "appCode", label: "App Code", type: "text", required: true, hideOnEdit: true },
    { name: "appName", label: "App Name", type: "text", required: true },
    {
      name: "companyCode",
      label: "Company",
      type: "select",
      required: true,
      options: companies.map((c) => ({ value: c.companyCode, label: c.companyName })),
    },
    { name: "description", label: "Description", type: "textarea" },
    { name: "icon", label: "Icon (an emoji — used when no logo is set)", type: "text" },
    { name: "appLogoUrl", label: "Logo URL (e.g. /logos/my-app.png)", type: "text" },
    { name: "displayOrder", label: "Display Order", type: "number", required: true, defaultValue: 0 },
    { name: "isActive", label: "Active", type: "checkbox", defaultValue: true },
  ];

  const columns: ColumnConfig[] = [
    { key: "appCode", label: "Code" },
    { key: "appName", label: "Name" },
    { key: "companyCode", label: "Company" },
    { key: "icon", label: "Icon" },
    { key: "displayOrder", label: "Order" },
    { key: "isActive", label: "Active" },
  ];

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-foreground">App Master</h1>
      <p className="mb-4 text-sm text-foreground/60">
        Each app is one product within a company, shown in the app switcher at the top right. Who can open an app is
        never set here — it follows from the menus a user already has: assign a menu to an app in Menu Master, and
        anyone whose role grants that menu gets the app. A menu left without an app is global and appears in every app.
      </p>
      <AdminCrudTable
        apiBasePath="/api/admin/apps"
        idField="appCode"
        columns={columns}
        fields={fields}
        initialData={apps}
        currentUsername={session!.username}
        compactActions
        companyFilterOptions={companies.map((c) => ({ value: c.companyCode, label: c.companyName }))}
      />
    </div>
  );
}
