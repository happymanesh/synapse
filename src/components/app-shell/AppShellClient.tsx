"use client";

import { useEffect, useMemo, useState } from "react";
import TopBar, { type Orientation, type SearchEntry, type Theme } from "./TopBar";
import Sidebar, { DASHBOARD_ITEM, type MenuItem } from "./Sidebar";
import type { AppEntry } from "./AppSwitcher";
import { SidebarControlProvider } from "./sidebar-control";
import { ActiveAppProvider } from "./active-app";
import { NotificationsProvider } from "./notifications-context";
import { MenuUsageProvider } from "./menu-usage";
import LoginNotificationPopup from "./LoginNotificationPopup";
import { LanguageProvider, type LanguageCode } from "@/lib/i18n";

const STORAGE_KEY = "synapse-ui-prefs";

/** Flattens the menu tree (with a breadcrumb trail) into a searchable list for the top-bar search. */
function flattenMenu(items: MenuItem[], trail: string[] = []): SearchEntry[] {
  const out: SearchEntry[] = [];
  for (const item of items) {
    const path = [...trail, item.name];
    out.push({
      code: item.code,
      name: item.name,
      icon: item.icon,
      routePath: item.routePath,
      menuType: item.menuType,
      externalUrl: item.externalUrl,
      breadcrumb: path.join(" › "),
    });
    if (item.children?.length) out.push(...flattenMenu(item.children, path));
  }
  return out;
}

interface UiPrefs {
  theme: Theme;
  orientation: Orientation;
  collapsed: boolean;
  language: LanguageCode;
  newWindow: boolean;
}

const DEFAULT_PREFS: UiPrefs = {
  theme: "day",
  orientation: "vertical",
  collapsed: false,
  language: "en",
  newWindow: false,
};

export default function AppShellClient({
  fullName,
  hierarchyName,
  companyName,
  companyLogoUrl,
  menuItems,
  apps,
  activeApp,
  children,
}: {
  fullName: string;
  hierarchyName: string;
  companyName: string;
  companyLogoUrl: string | null;
  menuItems: MenuItem[];
  /** Apps this user can open — resolved server-side from their roles' menus. */
  apps: AppEntry[];
  activeApp: AppEntry | null;
  children: React.ReactNode;
}) {
  const [prefs, setPrefs] = useState<UiPrefs>(DEFAULT_PREFS);
  const [searchTerm, setSearchTerm] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const searchIndex = useMemo(() => flattenMenu([DASHBOARD_ITEM, ...menuItems]), [menuItems]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      // One-time read from localStorage after mount (can't run during SSR as a lazy initializer).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (stored) setPrefs({ ...DEFAULT_PREFS, ...JSON.parse(stored) });
    } catch {
      // ignore malformed storage
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    document.documentElement.setAttribute("data-theme", prefs.theme);
  }, [prefs, hydrated]);

  return (
    <LanguageProvider language={prefs.language}>
      <ActiveAppProvider code={activeApp?.code ?? null}>
      <NotificationsProvider>
      <MenuUsageProvider menuItems={menuItems} appCode={activeApp?.code ?? null}>
      <SidebarControlProvider value={{ collapseSidebar: () => setPrefs((p) => ({ ...p, collapsed: true })) }}>
        <div className="flex h-screen flex-col overflow-hidden">
          <TopBar
            fullName={fullName}
            hierarchyName={hierarchyName}
            companyName={companyName}
            companyLogoUrl={companyLogoUrl}
            searchTerm={searchTerm}
            onSearchChange={setSearchTerm}
            searchIndex={searchIndex}
            theme={prefs.theme}
            onThemeChange={(theme) => setPrefs((p) => ({ ...p, theme }))}
            orientation={prefs.orientation}
            onOrientationChange={(orientation) => setPrefs((p) => ({ ...p, orientation }))}
            language={prefs.language}
            onLanguageChange={(language) => setPrefs((p) => ({ ...p, language }))}
            apps={apps}
            activeApp={activeApp}
            newWindow={prefs.newWindow}
          />
          <div className={prefs.orientation === "horizontal" ? "flex flex-1 flex-col overflow-hidden" : "flex flex-1 overflow-hidden"}>
            <Sidebar
              items={menuItems}
              collapsed={prefs.collapsed}
              onToggleCollapsed={() => setPrefs((p) => ({ ...p, collapsed: !p.collapsed }))}
              orientation={prefs.orientation}
              searchTerm={searchTerm}
              newWindow={prefs.newWindow}
              onToggleNewWindow={() => setPrefs((p) => ({ ...p, newWindow: !p.newWindow }))}
            />
            {/*
              Keyed on the active app so switching apps remounts the page rather than
              just re-rendering it. router.refresh() alone re-runs the server layout
              (sidebar, search index, app name) but leaves client pages mounted — the
              dashboard fetches its favorites once on mount, so without this it would
              keep showing the previous app's favorites after a switch.
            */}
            <main key={activeApp?.code ?? "__no_app__"} className="flex-1 overflow-y-auto bg-surface p-6">
              {children}
            </main>
          </div>
        </div>
        <LoginNotificationPopup />
      </SidebarControlProvider>
      </MenuUsageProvider>
      </NotificationsProvider>
      </ActiveAppProvider>
    </LanguageProvider>
  );
}
