"use client";

import RoleMenuMappingModal from "./RoleMenuMappingModal";

export default function RoleRowActions({ row }: { row: Record<string, unknown> }) {
  return <RoleMenuMappingModal roleCode={String(row.roleCode)} roleName={String(row.roleName)} />;
}
