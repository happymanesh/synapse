"use client";

import ResetPasswordModal from "./ResetPasswordModal";
import UserRoleMappingModal from "./UserRoleMappingModal";

export default function UserRowActions({ row }: { row: Record<string, unknown> }) {
  return (
    <>
      <ResetPasswordModal userUid={Number(row.uid)} username={String(row.username)} />
      <UserRoleMappingModal userUid={Number(row.uid)} username={String(row.username)} />
    </>
  );
}
