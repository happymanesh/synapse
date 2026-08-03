import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import AdminCrudTable, { type FieldConfig, type ColumnConfig } from "@/components/admin/AdminCrudTable";
import RoleRowActions from "@/components/admin/RoleRowActions";

export default async function RolesAdminPage() {
  const [roles, companies, hierarchies, session] = await Promise.all([
    prisma.roleMaster.findMany({ orderBy: { roleCode: "asc" } }),
    prisma.companyMaster.findMany({ select: { companyCode: true, companyName: true }, orderBy: { companyCode: "asc" } }),
    prisma.hierarchyMaster.findMany({ select: { hierarchyCode: true, hierarchyName: true }, orderBy: { seqId: "asc" } }),
    getSession(),
  ]);

  const fields: FieldConfig[] = [
    { name: "roleCode", label: "Role Code", type: "text", required: true, hideOnEdit: true },
    { name: "roleName", label: "Role Name", type: "text", required: true },
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
    { key: "roleCode", label: "Code" },
    { key: "roleName", label: "Name" },
    { key: "companyCode", label: "Company" },
    { key: "hierarchyCode", label: "Hierarchy" },
    { key: "isActive", label: "Active" },
  ];

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-foreground">Role Master</h1>
      <AdminCrudTable
        apiBasePath="/api/admin/roles"
        idField="roleCode"
        columns={columns}
        fields={fields}
        initialData={roles}
        RowActions={RoleRowActions}
        currentUsername={session!.username}
        compactActions
        companyFilterOptions={companies.map((c) => ({ value: c.companyCode, label: c.companyName }))}
      />
    </div>
  );
}
