import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import AdminCrudTable, { type FieldConfig, type ColumnConfig } from "@/components/admin/AdminCrudTable";

export default async function IpMappingsAdminPage() {
  const [mappings, users, session] = await Promise.all([
    prisma.userIpMapping.findMany({
      orderBy: { id: "asc" },
      include: { user: { select: { username: true, fullName: true } } },
    }),
    prisma.userDetails.findMany({ select: { uid: true, username: true, fullName: true }, orderBy: { username: "asc" } }),
    getSession(),
  ]);

  const rows = mappings.map((m) => ({
    id: m.id,
    userUid: m.userUid,
    username: `${m.user.username} (${m.user.fullName})`,
    ipMapping: m.ipMapping,
    isActive: m.isActive,
  }));

  const fields: FieldConfig[] = [
    {
      name: "userUid",
      label: "User",
      type: "select",
      required: true,
      options: users.map((u) => ({ value: String(u.uid), label: `${u.username} (${u.fullName})` })),
    },
    { name: "ipMapping", label: "IP Pattern (e.g. 192.168.1.10 or 192.168.*.*)", type: "text", required: true },
    { name: "isActive", label: "Active", type: "checkbox", defaultValue: true },
  ];

  const columns: ColumnConfig[] = [
    { key: "username", label: "User" },
    { key: "ipMapping", label: "IP Pattern" },
    { key: "isActive", label: "Active" },
  ];

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-foreground">User IP Mapping</h1>
      <p className="mb-4 text-sm text-foreground/60">
        A user with no active mapping here can log in from any network. Adding a mapping restricts them to matching IPs.
      </p>
      <AdminCrudTable
        apiBasePath="/api/admin/ip-mappings"
        idField="id"
        columns={columns}
        fields={fields}
        initialData={rows}
        currentUsername={session!.username}
        compactActions
      />
    </div>
  );
}
