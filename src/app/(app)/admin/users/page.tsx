import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import AdminCrudTable, { type FieldConfig, type ColumnConfig } from "@/components/admin/AdminCrudTable";
import UserRowActions from "@/components/admin/UserRowActions";
import { getUsersPage } from "@/lib/admin-users";

const PAGE_SIZE = 20;

export default async function UsersAdminPage() {
  const [{ rows: users, total }, companies, hierarchies, clientCategories, session] = await Promise.all([
    getUsersPage({ page: 1, pageSize: PAGE_SIZE }),
    prisma.companyMaster.findMany({ select: { companyCode: true, companyName: true }, orderBy: { companyCode: "asc" } }),
    prisma.hierarchyMaster.findMany({ select: { hierarchyCode: true, hierarchyName: true }, orderBy: { seqId: "asc" } }),
    prisma.clientCategoryMaster.findMany({
      select: { clientCategoryCode: true, clientCategoryName: true },
      orderBy: { clientCategoryCode: "asc" },
    }),
    getSession(),
  ]);

  const fields: FieldConfig[] = [
    {
      name: "companyCode",
      label: "Company",
      type: "select",
      required: true,
      options: companies.map((c) => ({ value: c.companyCode, label: c.companyName })),
    },
    { name: "username", label: "Username", type: "text", required: true, hideOnEdit: true },
    { name: "password", label: "Password", type: "password", required: true, hideOnEdit: true },
    { name: "customerId", label: "Customer ID", type: "text" },
    { name: "fullName", label: "Full Name", type: "text", required: true },
    { name: "mobile", label: "Mobile", type: "text" },
    { name: "email", label: "Email", type: "text" },
    {
      name: "hierarchyCode",
      label: "Hierarchy",
      type: "select",
      required: true,
      options: hierarchies.map((h) => ({ value: h.hierarchyCode, label: h.hierarchyName })),
    },
    {
      name: "clientCategoryCode",
      label: "Client Category",
      type: "select",
      required: true,
      defaultValue: "C00",
      options: clientCategories.map((c) => ({ value: c.clientCategoryCode, label: c.clientCategoryName })),
    },
    { name: "isActive", label: "Active", type: "checkbox", defaultValue: true },
  ];

  const columns: ColumnConfig[] = [
    { key: "username", label: "Username" },
    { key: "fullName", label: "Full Name" },
    { key: "companyCode", label: "Company" },
    { key: "hierarchyName", label: "Hierarchy" },
    { key: "clientCategoryName", label: "Category" },
    { key: "roles", label: "Roles" },
    { key: "isActive", label: "Active" },
  ];

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-foreground">User Master</h1>
      <AdminCrudTable
        apiBasePath="/api/admin/users"
        idField="uid"
        columns={columns}
        fields={fields}
        initialData={users}
        initialTotal={total}
        paging={{ pageSize: PAGE_SIZE }}
        companyFilterOptions={companies.map((c) => ({ value: c.companyCode, label: c.companyName }))}
        RowActions={UserRowActions}
        currentUsername={session!.username}
        compactActions
      />
    </div>
  );
}
