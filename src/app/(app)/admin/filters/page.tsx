import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import AdminCrudTable, { type FieldConfig, type ColumnConfig } from "@/components/admin/AdminCrudTable";
import { AdminRowActionsProvider } from "@/components/admin/AdminRowActionsContext";
import FilterRowActions from "@/components/admin/FilterRowActions";

const fields: FieldConfig[] = [
  { name: "filterId", label: "Filter ID", type: "text", required: true, hideOnEdit: true },
  { name: "filterName", label: "Filter Name", type: "text", required: true },
  { name: "isCollapsible", label: "Collapsible", type: "checkbox", defaultValue: true },
  { name: "defaultCollapsed", label: "Collapsed by default", type: "checkbox", defaultValue: false },
  { name: "isActive", label: "Active", type: "checkbox", defaultValue: true },
];

const columns: ColumnConfig[] = [
  { key: "filterId", label: "Filter ID" },
  { key: "filterName", label: "Name" },
  { key: "isCollapsible", label: "Collapsible" },
  { key: "defaultCollapsed", label: "Collapsed by default" },
  { key: "isActive", label: "Active" },
];

export default async function FiltersAdminPage() {
  const [filters, components, session] = await Promise.all([
    prisma.filterDefinition.findMany({ orderBy: { filterId: "asc" } }),
    prisma.filterComponentMaster.findMany({
      where: { isActive: true },
      select: { componentCode: true, componentName: true },
      orderBy: { componentCode: "asc" },
    }),
    getSession(),
  ]);

  const componentOptions = components.map((c) => ({ value: c.componentCode, label: `${c.componentName} (${c.componentCode})` }));

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-foreground">Filter Definitions</h1>
      <p className="mb-4 text-sm text-foreground/60">
        Arrange components into a named FilterID — used by reports and forms below.
      </p>
      <AdminRowActionsProvider value={{ currentUsername: session!.username, componentOptions }}>
        <AdminCrudTable
          apiBasePath="/api/admin/filters"
          idField="filterId"
          columns={columns}
          fields={fields}
          initialData={filters}
          currentUsername={session!.username}
          RowActions={FilterRowActions}
          compactActions
        />
      </AdminRowActionsProvider>
    </div>
  );
}
