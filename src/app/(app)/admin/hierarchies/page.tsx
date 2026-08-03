import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import AdminCrudTable, { type FieldConfig, type ColumnConfig } from "@/components/admin/AdminCrudTable";

const fields: FieldConfig[] = [
  { name: "hierarchyCode", label: "Hierarchy Code", type: "text", required: true, hideOnEdit: true },
  { name: "hierarchyName", label: "Hierarchy Name", type: "text", required: true },
  { name: "description", label: "Description", type: "textarea" },
  { name: "seqId", label: "Seq ID", type: "text", required: true },
  { name: "isActive", label: "Active", type: "checkbox", defaultValue: true },
];

const columns: ColumnConfig[] = [
  { key: "hierarchyCode", label: "Code" },
  { key: "hierarchyName", label: "Name" },
  { key: "seqId", label: "Seq ID" },
  { key: "isActive", label: "Active" },
];

export default async function HierarchiesAdminPage() {
  const [hierarchies, session] = await Promise.all([
    prisma.hierarchyMaster.findMany({ orderBy: { seqId: "asc" } }),
    getSession(),
  ]);

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-foreground">Hierarchy Master</h1>
      <AdminCrudTable
        apiBasePath="/api/admin/hierarchies"
        idField="hierarchyCode"
        columns={columns}
        fields={fields}
        initialData={hierarchies}
        currentUsername={session!.username}
        compactActions
      />
    </div>
  );
}
