import { cache } from "react";
import { prisma } from "@/lib/db";

export interface AppItem {
  code: string;
  name: string;
  icon: string | null;
  logoUrl: string | null;
}

/**
 * The set of menu codes a user can reach: user -> active roles -> role_menu_map
 * (scoped to their company + hierarchy) -> active menus. This is the single source
 * of truth both getMenuForUser and getAppsForUser build on, so "what menus can I
 * see" and "what apps can I open" can never drift apart.
 *
 * Wrapped in React `cache()`: on a full render pass the layout and the page both need
 * this (the report page resolves a breadcrumb from the same tree), and cache() collapses
 * that to one resolution per request. It is per-request only — nothing is shared between
 * users or across requests, so a role change still takes effect on the next navigation.
 */
export const getAccessibleMenuCodes = cache(async (userUid: number): Promise<string[]> => {
  const user = await prisma.userDetails.findUnique({
    where: { uid: userUid },
    include: {
      userRoles: {
        where: { isActive: true, role: { isActive: true } },
        include: { role: true },
      },
    },
  });
  if (!user) return [];

  const roleCodes = user.userRoles.map((ur) => ur.roleCode);
  if (roleCodes.length === 0) return [];

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

  return [...new Set(roleMenuMaps.map((m) => m.menuCode))];
});

/**
 * Which apps a user can open. There is no user->app mapping table: access is derived
 * from the menus they can already reach (menu.appCode), so granting a role a menu
 * automatically grants the app that menu belongs to. Menus with a NULL appCode are
 * "global" (e.g. Administration) and deliberately grant no app on their own.
 */
export async function getAppsForUser(userUid: number): Promise<AppItem[]> {
  const menuCodes = await getAccessibleMenuCodes(userUid);
  if (menuCodes.length === 0) return [];

  const menus = await prisma.menuMaster.findMany({
    where: { menuCode: { in: menuCodes }, appCode: { not: null } },
    select: { appCode: true },
  });
  const appCodes = [...new Set(menus.map((m) => m.appCode!))];
  if (appCodes.length === 0) return [];

  const apps = await prisma.appMaster.findMany({
    where: { appCode: { in: appCodes }, isActive: true },
    orderBy: [{ displayOrder: "asc" }, { appName: "asc" }],
  });

  return apps.map((a) => ({
    code: a.appCode,
    name: a.appName,
    icon: a.icon,
    logoUrl: a.appLogoUrl,
  }));
}

/**
 * The app to open this session: the one the user last had open, as long as they still
 * have access to it (it could have been deactivated or their role revoked since), else
 * their first available app. Returns null when the user has no app-scoped menus at all —
 * a pure-admin account, which still sees every global menu.
 */
export async function resolveActiveApp(userUid: number, apps: AppItem[]): Promise<AppItem | null> {
  if (apps.length === 0) return null;
  const user = await prisma.userDetails.findUnique({
    where: { uid: userUid },
    select: { lastAppCode: true },
  });
  return apps.find((a) => a.code === user?.lastAppCode) ?? apps[0];
}
