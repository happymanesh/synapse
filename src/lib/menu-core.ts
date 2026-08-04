/**
 * Pure menu/app derivation logic — the rules that decide which menu options a user
 * sees, and under which app.
 *
 * Deliberately free of `server-only` and of any Prisma import so it can be unit
 * tested directly (see tests/menu-core.test.ts). The DB-backed callers that feed it
 * rows live in `@/lib/menu` and `@/lib/user-shell`, which re-export from here.
 */

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
    // A parent the user has no access to isn't in `menus` at all, so the child would
    // silently disappear if it were only ever attached to a parent. Promoting it to a
    // root keeps a granted menu reachable rather than orphaning it.
    const parent = m.parentMenuCode ? byCode.get(m.parentMenuCode) : undefined;
    if (parent) {
      parent.children!.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
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

/**
 * Narrows a user's granted menus to one app.
 *
 * Global menus (appCode = null) stay visible in every app — that's what keeps
 * Administration reachable regardless of which app is selected. With no active app
 * (a user whose menus are all global) nothing is filtered out.
 */
export function scopeMenusToApp<T extends { appCode: string | null }>(menus: T[], activeAppCode: string | null): T[] {
  if (!activeAppCode) return menus;
  return menus.filter((m) => m.appCode === activeAppCode || m.appCode === null);
}

/** The app to open now: the last one used if it's still accessible, else the first available. */
export function pickActiveApp<T extends { code: string }>(apps: T[], lastAppCode: string | null): T | null {
  return apps.find((a) => a.code === lastAppCode) ?? apps[0] ?? null;
}
