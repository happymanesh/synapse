"use client";

import { createContext, useContext, useMemo } from "react";
import type { MenuItem } from "./Sidebar";

interface MenuPosition {
  name: string;
  mainMenu: string | null;
  subMenu: string | null;
  routePath: string | null;
}

interface MenuUsageValue {
  /** Records a menu selection. Fire-and-forget: never awaited, never blocks navigation. */
  logSelection: (menuCode: string) => void;
}

const MenuUsageContext = createContext<MenuUsageValue>({ logSelection: () => {} });

/** Flattens the tree once into menuCode -> where it sits, so a click costs a Map lookup. */
function buildPositionIndex(items: MenuItem[], trail: string[] = [], into = new Map<string, MenuPosition>()) {
  for (const item of items) {
    into.set(item.code, {
      name: item.name,
      mainMenu: trail[0] ?? null,
      subMenu: trail[1] ?? null,
      routePath: item.routePath ?? null,
    });
    if (item.children?.length) buildPositionIndex(item.children, [...trail, item.name], into);
  }
  return into;
}

export function MenuUsageProvider({
  menuItems,
  appCode,
  children,
}: {
  menuItems: MenuItem[];
  appCode: string | null;
  children: React.ReactNode;
}) {
  const index = useMemo(() => buildPositionIndex(menuItems), [menuItems]);

  const value = useMemo<MenuUsageValue>(
    () => ({
      logSelection(menuCode: string) {
        const pos = index.get(menuCode);
        if (!pos) return;
        // keepalive lets the request outlive the page navigation it accompanies, which is
        // the whole point — the click is usually followed immediately by a route change.
        // Deliberately not awaited, and failures are swallowed: logging must never be able
        // to slow down or break navigation.
        try {
          fetch("/api/menu-usage", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            keepalive: true,
            body: JSON.stringify({
              menuCode,
              menuName: pos.name,
              mainMenu: pos.mainMenu,
              subMenu: pos.subMenu,
              routePath: pos.routePath,
              appCode,
            }),
          }).catch(() => {});
        } catch {
          // ignore
        }
      },
    }),
    [index, appCode]
  );

  return <MenuUsageContext.Provider value={value}>{children}</MenuUsageContext.Provider>;
}

export function useMenuUsage(): MenuUsageValue {
  return useContext(MenuUsageContext);
}
