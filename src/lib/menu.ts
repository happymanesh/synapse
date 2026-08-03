import { prisma } from "@/lib/db";
import { getAccessibleMenuCodes } from "@/lib/apps";

export interface MenuItem {
  code: string;
  name: string;
  icon?: string;
  routePath?: string;
  menuType?: string;
  externalUrl?: string;
  children?: MenuItem[];
}

export interface MenuRow {
  menuCode: string;
  parentMenuCode: string | null;
  menuName: string;
  icon: string | null;
  routePath: string | null;
  displayOrder: number;
  menuType: string;
  externalUrl: string | null;
  reportId: string | null;
}

export function buildMenuTree(menus: MenuRow[]): MenuItem[] {
  const byCode = new Map<string, MenuItem>(
    menus.map((m) => [
      m.menuCode,
      {
        code: m.menuCode,
        name: m.menuName,
        icon: m.icon ?? undefined,
        routePath: m.menuType === "REPORT" && m.reportId ? `/reports/${m.reportId}` : (m.routePath ?? undefined),
        menuType: m.menuType,
        externalUrl: m.externalUrl ?? undefined,
        children: [],
      },
    ])
  );

  const roots: MenuItem[] = [];
  for (const m of menus) {
    const node = byCode.get(m.menuCode)!;
    const parent = m.parentMenuCode ? byCode.get(m.parentMenuCode) : undefined;
    if (parent) {
      parent.children!.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

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
    where: {
      menuCode: { in: menuCodes },
      ...(appCode ? { OR: [{ appCode }, { appCode: null }] } : {}),
    },
    orderBy: { displayOrder: "asc" },
  });

  return buildMenuTree(menus);
}

/** DFS: the chain of names from a root item down to the node whose routePath matches, or null if not found. */
export function findBreadcrumb(items: MenuItem[], routePath: string, trail: string[] = []): string[] | null {
  for (const item of items) {
    const path = [...trail, item.name];
    if (item.routePath === routePath) return path;
    if (item.children?.length) {
      const found = findBreadcrumb(item.children, routePath, path);
      if (found) return found;
    }
  }
  return null;
}
