"use client";

import MappingChecklistModal from "./MappingChecklistModal";

const COLUMNS = [
  { key: "code", label: "Code" },
  { key: "name", label: "Name" },
  { key: "hierarchy", label: "Hierarchy" },
  { key: "company", label: "Company" },
];

export default function UserRoleMappingModal({ userUid, username }: { userUid: number; username: string }) {
  return (
    <MappingChecklistModal
      triggerLabel="Manage roles"
      triggerIcon="🛡️"
      title={`Roles for ${username}`}
      fetchUrl={`/api/admin/users/${userUid}/roles`}
      saveUrl={`/api/admin/users/${userUid}/roles`}
      columns={COLUMNS}
    />
  );
}
