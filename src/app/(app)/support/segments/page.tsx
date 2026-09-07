import { prisma } from "@/lib/db";
import { requireMenu } from "@/lib/auth";
import { SUPPORT_MENU } from "@/lib/support-schemas";
import AdminCrudTable, { type FieldConfig, type ColumnConfig } from "@/components/admin/AdminCrudTable";

const columns: ColumnConfig[] = [
  { key: "code", label: "Code" },
  { key: "name", label: "Name" },
  { key: "displayOrder", label: "Order" },
  { key: "createdBy", label: "Added By" },
  { key: "isActive", label: "Active" },
];

const fields: FieldConfig[] = [
  { name: "code", label: "Code (e.g. EQ-CASH)", type: "text", required: true, hideOnEdit: true },
  { name: "name", label: "Name", type: "text", required: true },
  { name: "displayOrder", label: "Display Order", type: "number", defaultValue: 0 },
  { name: "isActive", label: "Active", type: "checkbox", defaultValue: true },
];

export default async function SegmentsPage() {
  const session = await requireMenu(SUPPORT_MENU.SEGMENTS);
  const rows = await prisma.segmentMaster.findMany({ orderBy: [{ displayOrder: "asc" }, { name: "asc" }] });

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-foreground">Segments</h1>
      <p className="mb-4 max-w-3xl text-sm text-foreground/60">
        The market segments a ticket can relate to. Keep a “Not Applicable” entry so the field can stay mandatory without forcing a misleading answer. Staff can add one from the raise screen when it&apos;s missing, and it appears here with who
        added it. One already used by tickets can&apos;t be deleted; deactivate it instead, which hides it from
        new tickets without changing how existing ones were classified.
      </p>
      <AdminCrudTable
        apiBasePath="/api/support/segments"
        idField="id"
        columns={columns}
        fields={fields}
        initialData={rows}
        currentUsername={session.username}
        compactActions
      />
    </div>
  );
}
