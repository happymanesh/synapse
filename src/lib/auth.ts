import "server-only";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession, type SessionPayload } from "@/lib/session";

export const ADMIN_ROLE_CODE = "ADMIN";

export async function isAdminUser(userUid: number): Promise<boolean> {
  const membership = await prisma.userRoleMap.findFirst({
    where: {
      userUid,
      roleCode: ADMIN_ROLE_CODE,
      isActive: true,
      role: { isActive: true },
    },
  });
  return !!membership;
}

/** Redirects to /dashboard unless the current session belongs to an active ADMIN. */
export async function requireAdmin(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const admin = await isAdminUser(session.userUid);
  if (!admin) {
    redirect("/dashboard");
  }
  return session;
}
