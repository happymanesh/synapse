import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import AdminCrudTable, { type FieldConfig, type ColumnConfig } from "@/components/admin/AdminCrudTable";

const fields: FieldConfig[] = [
  { name: "companyCode", label: "Company Code", type: "text", required: true, hideOnEdit: true },
  { name: "companyName", label: "Company Name", type: "text", required: true },
  { name: "isActive", label: "Active", type: "checkbox", defaultValue: true },
  { name: "panNo", label: "PAN No", type: "text" },
  { name: "tanNo", label: "TAN No", type: "text" },
  { name: "regdOfficeAddress", label: "Regd. Office Address", type: "textarea" },
  { name: "companyLogoFileLocation", label: "Logo File Location", type: "text" },
];

const columns: ColumnConfig[] = [
  { key: "companyCode", label: "Code" },
  { key: "companyName", label: "Name" },
  { key: "isActive", label: "Active" },
];

export default async function CompaniesAdminPage() {
  const [companies, session] = await Promise.all([
    prisma.companyMaster.findMany({ orderBy: { companyCode: "asc" } }),
    getSession(),
  ]);

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-foreground">Company Master</h1>
      <AdminCrudTable
        apiBasePath="/api/admin/companies"
        idField="companyCode"
        columns={columns}
        fields={fields}
        initialData={companies}
        currentUsername={session!.username}
        compactActions
      />
    </div>
  );
}
