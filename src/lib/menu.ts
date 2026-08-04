import { prisma } from "@/lib/db";
import { getAccessibleMenuCodes } from "@/lib/apps";
import { buildMenuTree, scopeMenusToApp } from "@/lib/menu-core";

// The tree/breadcrumb/scoping rules live in menu-core so they can be unit tested
// without a database; re-exported here so existing importers are unaffected.
export { buildMenuTree, findBreadcrumb, scopeMenusToApp, pickActiveApp } from "@/lib/menu-core";
export type { MenuItem, MenuRow } from "@/lib/menu-core";
import type { MenuItem } from "@/lib/menu-core";

/**
 * Resolves the menu tree for a user: user -> active roles -> role_menu_map
 * (scoped to the user's company + hierarchy) -> menu_master, 3 levels deep.
 * Dashboard is intentionally not part of this tree — it's a static first
 * item rendered by the sidebar itself.
 *
 * `appCode` narrows the tree to the currently-open app. Menus with a NULL appCode
 * are always included — they're global (Administration), so switching apps can never
 * hide system administration from an admin.
 */
export async function getMenuForUser(userUid: number, appCode?: string | null): Promise<MenuItem[]> {
  const menuCodes = await getAccessibleMenuCodes(userUid);
  if (menuCodes.length === 0) return [];

  const menus = await prisma.menuMaster.findMany({
    where: { menuCode: { in: menuCodes } },
    orderBy: { displayOrder: "asc" },
  });

  return buildMenuTree(scopeMenusToApp(menus, appCode ?? null));
}
