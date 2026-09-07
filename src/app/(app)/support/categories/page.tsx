import { prisma } from "@/lib/db";
import { requireMenu } from "@/lib/auth";
import { ISSUE_TYPES, NEW_MODULE_SENTINEL, SUPPORT_MENU } from "@/lib/support-schemas";
import AdminCrudTable, { type FieldConfig, type ColumnConfig } from "@/components/admin/AdminCrudTable";

const columns: ColumnConfig[] = [
  { key: "categoryCode", label: "Code" },
  { key: "categoryName", label: "Name" },
  { key: "productModule", label: "Product / Module" },
  { key: "issueType", label: "Issue Type" },
  { key: "displayOrder", label: "Order" },
  { key: "isActive", label: "Active" },
];

export default async function IssueCategoriesPage() {
  // Gated on the menu grant, not requireAdmin(): §4.3 makes the support lead the owner of
  // this taxonomy, and an admin-only gate would lock out the very person meant to run it.
  const session = await requireMenu(SUPPORT_MENU.CATEGORIES);

  const categories = await prisma.issueCategory.findMany({
    orderBy: [{ displayOrder: "asc" }, { categoryName: "asc" }],
  });

  // The module axis genuinely grows, so the dropdown is built from what already exists and
  // carries an escape hatch for a genuinely new one. A hardcoded list would need a code
  // change to add a module; free text would split reports on typos.
  const existingModules = [...new Set(categories.map((c) => c.productModule))].sort();

  const fields: FieldConfig[] = [
    { name: "categoryCode", label: "Category Code (e.g. EQ-BUG)", type: "text", required: true, hideOnEdit: true },
    { name: "categoryName", label: "Category Name", type: "text", required: true },
    {
      name: "productModule",
      label: "Product / Module",
      type: "select",
      required: true,
      options: [
        ...existingModules.map((m) => ({ value: m, label: m })),
        { value: NEW_MODULE_SENTINEL, label: "+ Add a new module…" },
      ],
    },
    {
      name: "productModuleNew",
      label: "New Product / Module name",
      type: "text",
      showWhen: { field: "productModule", equals: NEW_MODULE_SENTINEL },
    },
    {
      name: "issueType",
      label: "Issue Type",
      type: "select",
      required: true,
      options: ISSUE_TYPES.map((t) => ({ value: t, label: t.replace(/_/g, " ") })),
    },
    { name: "description", label: "Description", type: "textarea" },
    { name: "displayOrder", label: "Display Order", type: "number", defaultValue: 0 },
    { name: "isActive", label: "Active", type: "checkbox", defaultValue: true },
  ];

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-foreground">Issue Categories</h1>
      <p className="mb-4 max-w-3xl text-sm text-foreground/60">
        The taxonomy raisers pick from, on two axes — product/module and issue type. Both drive the ticket
        reports, so prefer editing an existing category over creating a near-duplicate. A category already used
        by tickets can&apos;t be deleted; deactivate it instead, which hides it from new tickets without
        changing how existing ones were classified.
      </p>
      <AdminCrudTable
        apiBasePath="/api/support/categories"
        idField="categoryCode"
        columns={columns}
        fields={fields}
        initialData={categories}
        currentUsername={session.username}
        compactActions
      />
    </div>
  );
}
