import { prisma } from "@/lib/db";
import { buildMenuTree, pickActiveApp, scopeMenusToApp, type MenuItem } from "@/lib/menu-core";
import type { AppItem } from "@/lib/apps";

export interface UserShellContext {
  /** Every app this user can open, derived from the menus their roles grant. */
  apps: AppItem[];
  /** The app to open now — last one used if still accessible, else the first available. */
  activeApp: AppItem | null;
  /** Menu tree already narrowed to the active app (plus global, appCode = null, menus). */
  menuItems: MenuItem[];
}

/**
 * Resolves everything the app shell needs in ONE pass.
 *
 * Composing getAppsForUser() + resolveActiveApp() + getMenuForUser() instead runs the
 * user->roles->role_menu_map->menus chain twice (each of those calls getAccessibleMenuCodes
 * internally) plus a third redundant user read for lastAppCode — roughly 7 queries per
 * navigation where 4 suffice. Those helpers still exist for callers that genuinely need
 * only one piece; the shell should always use this.
 */
export async function getUserShellContext(userUid: number): Promise<UserShellContext> {
  const empty: UserShellContext = { apps: [], activeApp: null, menuItems: [] };

  const user = await prisma.userDetails.findUnique({
    where: { uid: userUid },
    include: {
      userRoles: {
        where: { isActive: true, role: { isActive: true } },
        select: { roleCode: true },
      },
    },
  });
  if (!user) return empty;

  const roleCodes = user.userRoles.map((ur) => ur.roleCode);
  if (roleCodes.length === 0) return empty;

  const roleMenuMaps = await prisma.roleMenuMap.findMany({
    where: {
      roleCode: { in: roleCodes },
      companyCode: user.companyCode,
      hierarchyCode: user.hierarchyCode,
      isActive: true,
      menu: { isActive: true },
    },
    select: { menuCode: true },
  });
  const menuCodes = [...new Set(roleMenuMaps.map((m) => m.menuCode))];
  if (menuCodes.length === 0) return empty;

  const menus = await prisma.menuMaster.findMany({
    where: { menuCode: { in: menuCodes } },
    orderBy: { displayOrder: "asc" },
  });

  const appCodes = [...new Set(menus.map((m) => m.appCode).filter((c): c is string => !!c))];
  const appRows =
    appCodes.length > 0
      ? await prisma.appMaster.findMany({
          where: { appCode: { in: appCodes }, isActive: true },
          orderBy: [{ displayOrder: "asc" }, { appName: "asc" }],
        })
      : [];

  const apps: AppItem[] = appRows.map((a) => ({
    code: a.appCode,
    name: a.appName,
    icon: a.icon,
    logoUrl: a.appLogoUrl,
  }));
  const activeApp = pickActiveApp(apps, user.lastAppCode);
  const scoped = scopeMenusToApp(menus, activeApp?.code ?? null);

  return { apps, activeApp, menuItems: buildMenuTree(scoped) };
}
