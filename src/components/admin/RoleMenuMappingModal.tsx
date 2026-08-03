"use client";

import MappingChecklistModal from "./MappingChecklistModal";

const COLUMNS = [
  { key: "code", label: "Code" },
  { key: "name", label: "Name" },
  { key: "level", label: "Level" },
  { key: "parent", label: "Parent" },
  { key: "route", label: "Route" },
];

export default function RoleMenuMappingModal({ roleCode, roleName }: { roleCode: string; roleName: string }) {
  return (
    <MappingChecklistModal
      triggerLabel="Manage menus"
      triggerIcon="🧭"
      title={`Menus for ${roleName}`}
      fetchUrl={`/api/admin/roles/${encodeURIComponent(roleCode)}/menus`}
      saveUrl={`/api/admin/roles/${encodeURIComponent(roleCode)}/menus`}
      columns={COLUMNS}
    />
  );
}
