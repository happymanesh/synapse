"use client";

import AdminCrudTable, { type FieldConfig, type ColumnConfig, type Row } from "@/components/admin/AdminCrudTable";
import { formatDateTime } from "@/lib/report-format";

interface HierarchyOption {
  hierarchyCode: string;
  hierarchyName: string;
}

interface UserOption {
  uid: number;
  fullName: string;
  username: string;
}

/**
 * Client wrapper so the `render` callbacks below can be built here (client-side),
 * not passed in as props from the Server Component page — functions can't cross
 * that boundary, and AdminCrudTable's optimistic add/edit rows need render to
 * recompute display text from raw fields anyway, not from a value baked in at fetch time.
 */
export default function NotificationsClient({
  notifications,
  hierarchies,
  users,
  currentUsername,
}: {
  notifications: Row[];
  hierarchies: HierarchyOption[];
  users: UserOption[];
  currentUsername: string;
}) {
  const fields: FieldConfig[] = [
    {
      name: "targetType",
      label: "Message for",
      type: "select",
      required: true,
      defaultValue: "HIERARCHY",
      options: [
        { value: "HIERARCHY", label: "Hierarchy" },
        { value: "USER", label: "Specific user" },
      ],
    },
    {
      name: "targetHierarchyCode",
      label: "Hierarchy",
      type: "select",
      showWhen: { field: "targetType", equals: "HIERARCHY" },
      options: hierarchies.map((h) => ({ value: h.hierarchyCode, label: h.hierarchyName })),
    },
    {
      name: "targetUserUid",
      label: "User",
      type: "select",
      showWhen: { field: "targetType", equals: "USER" },
      options: users.map((u) => ({ value: String(u.uid), label: `${u.fullName} (${u.username})` })),
    },
    { name: "deliveryPopup", label: "Popup", type: "checkbox", defaultValue: false },
    { name: "deliveryBell", label: "Notification", type: "checkbox", defaultValue: true, inlineWithPrevious: true },
    { name: "messageText", label: "Message", type: "textarea", required: true },
    { name: "scheduledFor", label: "Schedule date and time (leave blank to send immediately)", type: "datetime-local" },
    { name: "isActive", label: "Active", type: "checkbox", defaultValue: true },
  ];

  const columns: ColumnConfig[] = [
    {
      key: "targetType",
      label: "For",
      render: (row) =>
        row.targetType === "USER"
          ? `User: ${users.find((u) => u.uid === row.targetUserUid)?.fullName ?? row.targetUserUid}`
          : `Hierarchy: ${hierarchies.find((h) => h.hierarchyCode === row.targetHierarchyCode)?.hierarchyName ?? row.targetHierarchyCode}`,
    },
    {
      key: "messageText",
      label: "Message",
      render: (row) => {
        const text = String(row.messageText ?? "");
        return text.length > 60 ? `${text.slice(0, 60)}…` : text;
      },
    },
    { key: "deliveryPopup", label: "Popup" },
    { key: "deliveryBell", label: "Bell" },
    { key: "scheduledFor", label: "Scheduled", render: (row) => (row.scheduledFor ? formatDateTime(row.scheduledFor) : "—") },
    { key: "createdAt", label: "Sent", render: (row) => formatDateTime(row.createdAt) },
    { key: "isActive", label: "Active" },
  ];

  return (
    <AdminCrudTable
      apiBasePath="/api/admin/notifications"
      idField="id"
      columns={columns}
      fields={fields}
      initialData={notifications}
      currentUsername={currentUsername}
      compactActions
    />
  );
}
