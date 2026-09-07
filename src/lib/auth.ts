import "server-only";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getAccessibleMenuCodes } from "@/lib/apps";
import { getSession, type SessionPayload } from "@/lib/session";

export const ADMIN_ROLE_CODE = "ADMIN";
/** BRS §4.6 names Product/Ops management as the approval authority for change requests. */
export const PRODUCT_OPS_ROLE_CODE = "PRODUCT_OPS";

/**
 * Active membership of a role.
 *
 * A *capability* check, distinct from `hasMenuAccess()`, which asks what someone can see.
 * Approval authority must not depend on a navigation grant: deactivating a menu for
 * cosmetic reasons would otherwise silently transfer who may sign work off.
 */
export async function hasRole(userUid: number, roleCode: string): Promise<boolean> {
  const membership = await prisma.userRoleMap.findFirst({
    where: { userUid, roleCode, isActive: true, role: { isActive: true } },
  });
  return !!membership;
}

export async function isAdminUser(userUid: number): Promise<boolean> {
  return hasRole(userUid, ADMIN_ROLE_CODE);
}

/**
 * Who may approve or reject a change request (§4.6). ADMIN is included so a seeded
 * administrator can operate the flow before real Product/Ops accounts exist — the support
 * desk emphatically is not, which is the whole point of the gate.
 */
export async function canDecideChangeRequests(userUid: number): Promise<boolean> {
  return (await hasRole(userUid, PRODUCT_OPS_ROLE_CODE)) || (await isAdminUser(userUid));
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

/**
 * Whether the user has been granted a specific menu.
 *
 * Used to authorize features that belong to a role other than ADMIN — the issue taxonomy is
 * owned by the support lead (BRS §4.3), so `requireAdmin()` would put it out of the reach of
 * the very person meant to own it. Access stays derived from role -> menu (REBUILD §4.1)
 * rather than introducing a second permission table.
 *
 * Caveat worth knowing: this is false for a menu that has been deactivated, so deactivating
 * a menu also revokes any capability gated on it.
 */
export async function hasMenuAccess(userUid: number, menuCode: string): Promise<boolean> {
  return (await getAccessibleMenuCodes(userUid)).includes(menuCode);
}

/**
 * Page-level gate for a menu-owned feature. Mirrors `requireAdmin()`: redirects rather than
 * returning a status, because a browser navigation wants a destination.
 *
 * API routes must NOT use this — a redirect would hand `fetch()` an HTML page. They should
 * call `hasMenuAccess()` and return a 403 JSON body instead, the same reasoning as the
 * proxy's UNAUTHORIZED_JSON rule in `@/lib/auth-core`.
 */
export async function requireMenu(menuCode: string): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  if (!(await hasMenuAccess(session.userUid, menuCode))) {
    redirect("/dashboard");
  }
  return session;
}
