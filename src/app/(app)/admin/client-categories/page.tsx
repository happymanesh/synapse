import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import AdminCrudTable, { type FieldConfig, type ColumnConfig } from "@/components/admin/AdminCrudTable";

const fields: FieldConfig[] = [
  { name: "clientCategoryCode", label: "Category Code", type: "text", required: true, hideOnEdit: true },
  { name: "clientCategoryName", label: "Category Name", type: "text", required: true },
  { name: "isActive", label: "Active", type: "checkbox", defaultValue: true },
];

const columns: ColumnConfig[] = [
  { key: "clientCategoryCode", label: "Code" },
  { key: "clientCategoryName", label: "Name" },
  { key: "isActive", label: "Active" },
];

export default async function ClientCategoriesAdminPage() {
  const [categories, session] = await Promise.all([
    prisma.clientCategoryMaster.findMany({ orderBy: { clientCategoryCode: "asc" } }),
    getSession(),
  ]);

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-foreground">Client Category Master</h1>
      <AdminCrudTable
        apiBasePath="/api/admin/client-categories"
        idField="clientCategoryCode"
        columns={columns}
        fields={fields}
        initialData={categories}
        currentUsername={session!.username}
        compactActions
      />
    </div>
  );
}
