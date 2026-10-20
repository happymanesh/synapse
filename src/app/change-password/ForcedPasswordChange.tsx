"use client";

import { useRouter } from "next/navigation";
import ChangePasswordModal from "@/components/app-shell/ChangePasswordModal";

export default function ForcedPasswordChange() {
  const router = useRouter();
  return (
    <ChangePasswordModal
      forced
      onClose={() => {}}
      onChanged={() => {
        // The change-password route has re-issued the session without the claim.
        router.replace("/dashboard");
        router.refresh();
      }}
    />
  );
}
