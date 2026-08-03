import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import AdminCrudTable, { type FieldConfig, type ColumnConfig } from "@/components/admin/AdminCrudTable";

const fields: FieldConfig[] = [
  { name: "componentCode", label: "Component Code", type: "text", required: true, hideOnEdit: true },
  { name: "componentName", label: "Component Name", type: "text", required: true },
  {
    name: "componentType",
    label: "Type",
    type: "select",
    required: true,
    options: [
      { value: "TEXT", label: "Text" },
      { value: "NUMBER", label: "Number" },
      { value: "DATE", label: "Date" },
      { value: "DATE_RANGE", label: "Date Range" },
      { value: "DROPDOWN", label: "Dropdown" },
      { value: "MULTI_SELECT", label: "Multi-select" },
      { value: "CHECKBOX", label: "Checkbox" },
      { value: "RADIO", label: "Radio" },
    ],
  },
  {
    name: "dataSourceType",
    label: "Data Source",
    type: "select",
    required: true,
    defaultValue: "NONE",
    options: [
      { value: "NONE", label: "None" },
      { value: "STATIC", label: "Static list" },
      { value: "SQL", label: "SQL query" },
    ],
  },
  {
    name: "staticOptionsJson",
    label: 'Static options JSON (e.g. [{"value":"A","label":"Option A"}])',
    type: "textarea",
    showWhen: { field: "dataSourceType", equals: "STATIC" },
  },
  {
    name: "dataSourceQuery",
    label: "SQL query (use :parentValue for cascading)",
    type: "textarea",
    showWhen: { field: "dataSourceType", equals: "SQL" },
  },
  { name: "isActive", label: "Active", type: "checkbox", defaultValue: true },
];

const columns: ColumnConfig[] = [
  { key: "componentCode", label: "Code" },
  { key: "componentName", label: "Name" },
  { key: "componentType", label: "Type" },
  { key: "dataSourceType", label: "Data Source" },
  { key: "isActive", label: "Active" },
];

export default async function FilterComponentsAdminPage() {
  const [components, session] = await Promise.all([
    prisma.filterComponentMaster.findMany({ orderBy: { componentCode: "asc" } }),
    getSession(),
  ]);

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-foreground">Filter Component Master</h1>
      <p className="mb-4 text-sm text-foreground/60">
        The reusable component repository — build these once, then arrange them into filters below.
      </p>
      <AdminCrudTable
        apiBasePath="/api/admin/filter-components"
        idField="componentCode"
        columns={columns}
        fields={fields}
        initialData={components}
        currentUsername={session!.username}
        compactActions
      />
    </div>
  );
}
