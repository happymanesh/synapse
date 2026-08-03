"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLanguage } from "@/lib/i18n";
import type { MenuItem } from "@/lib/menu";
import { useMenuUsage } from "./menu-usage";

export type { MenuItem };

const DASHBOARD_CODE = "__dashboard__";

export const DASHBOARD_ITEM: MenuItem = {
  code: DASHBOARD_CODE,
  name: "Dashboard",
  icon: "📊",
  routePath: "/dashboard",
};

/**
 * The Dashboard entry is the only statically-named item in this tree — everything
 * else is admin-authored/DB-driven content that stays in whatever language it was
 * entered in. So only this one name gets translated for display.
 */
function displayName(item: MenuItem, t: ReturnType<typeof useLanguage>["t"]): string {
  return item.code === DASHBOARD_CODE ? t("dashboard") : item.name;
}

/** Renders one item's link/toggle content — shared between the sidebar row and the flyout. */
function ItemRow({ item, showIcon = true }: { item: MenuItem; showIcon?: boolean }) {
  const { t } = useLanguage();
  return (
    <>
      {showIcon && <span className="w-5 shrink-0 text-center">{item.icon ?? "•"}</span>}
      <span className="truncate">{displayName(item, t)}</span>
    </>
  );
}

/** target/rel for an internal link — "New window" toggle opens every menu selection in a new tab. */
function linkTargetProps(newWindow: boolean) {
  return newWindow ? { target: "_blank", rel: "noopener noreferrer" } : {};
}

function subtreeContainsRoute(items: MenuItem[], pathname: string): boolean {
  return items.some((i) => i.routePath === pathname || (i.children && subtreeContainsRoute(i.children, pathname)));
}

/** Which top-level ("main menu") item the current route lives under — the accordion's source of truth. */
function findActiveTopLevelCode(items: MenuItem[], pathname: string): string | null {
  for (const item of items) {
    if (item.routePath === pathname) return item.code;
    if (item.children?.length && subtreeContainsRoute(item.children, pathname)) return item.code;
  }
  return null;
}

/**
 * A collapsed-sidebar flyout: shows the item's name and its full (up to 2-level) child
 * tree for selection. Rendered via a portal at a fixed, JS-computed position — the
 * sidebar's own scroll container is `overflow-y-auto`, which (per the CSS overflow
 * spec) forces its cross-axis to `auto` too, clipping anything positioned absolute
 * inside it that extends past the collapsed rail's width.
 */
function CollapsedFlyout({
  item,
  anchorRect,
  newWindow,
  onNavigate,
}: {
  item: MenuItem;
  anchorRect: { top: number; left: number };
  newWindow: boolean;
  onNavigate: () => void;
}) {
  const { logSelection } = useMenuUsage();
  const select = (code: string) => {
    logSelection(code);
    onNavigate();
  };
  return createPortal(
    <div
      data-sidebar-flyout
      className="fixed z-30 min-w-48 rounded-md border border-chrome-border bg-chrome-background py-1 shadow-lg"
      style={{ top: anchorRect.top, left: anchorRect.left }}
    >
      <div className="border-b border-chrome-border px-3 py-2 text-xs font-semibold text-chrome-foreground/60 uppercase">
        {item.name}
      </div>
      {item.children!.map((child) => (
        <div key={child.code}>
          {child.routePath ? (
            <Link
              href={child.routePath}
              onClick={() => select(child.code)}
              {...linkTargetProps(newWindow)}
              className="flex items-center gap-2 px-3 py-2 text-sm text-chrome-foreground/80 hover:bg-chrome-surface hover:text-chrome-foreground"
            >
              <ItemRow item={child} />
            </Link>
          ) : child.menuType === "EXTERNAL" && child.externalUrl ? (
            <a
              href={child.externalUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => select(child.code)}
              className="flex items-center gap-2 px-3 py-2 text-sm text-chrome-foreground/80 hover:bg-chrome-surface hover:text-chrome-foreground"
            >
              <ItemRow item={child} />
            </a>
          ) : (
            <div className="px-3 py-2 text-sm font-medium text-chrome-foreground/70">
              <ItemRow item={child} />
            </div>
          )}
          {!!child.children?.length && (
            <div className="pb-1">
              {child.children.map((grandchild) =>
                grandchild.routePath ? (
                  <Link
                    key={grandchild.code}
                    href={grandchild.routePath}
                    onClick={() => select(grandchild.code)}
                    {...linkTargetProps(newWindow)}
                    className="flex items-center gap-2 py-1.5 pr-3 pl-8 text-sm text-chrome-foreground/70 hover:bg-chrome-surface hover:text-chrome-foreground"
                  >
                    <ItemRow item={grandchild} showIcon={false} />
                  </Link>
                ) : (
                  <div key={grandchild.code} className="py-1.5 pr-3 pl-8 text-sm text-chrome-foreground/70">
                    <ItemRow item={grandchild} showIcon={false} />
                  </div>
                )
              )}
            </div>
          )}
        </div>
      ))}
    </div>,
    document.body
  );
}

function MenuNode({
  item,
  collapsed,
  depth,
  newWindow,
  openFlyoutCode,
  onOpenFlyout,
  mainMenuOpen,
  onToggleMainMenu,
  horizontal,
}: {
  item: MenuItem;
  collapsed: boolean;
  depth: number;
  newWindow: boolean;
  openFlyoutCode: string | null;
  onOpenFlyout: (code: string | null) => void;
  /** Only meaningful at depth 0 — Sidebar drives this main-menu group as an accordion. */
  mainMenuOpen?: boolean;
  onToggleMainMenu?: () => void;
  /** Top-bar layout: children open in a dropdown below, never inline (there is no vertical room). */
  horizontal?: boolean;
}) {
  const { t } = useLanguage();
  const { logSelection } = useMenuUsage();
  const pathname = usePathname();
  const isTopLevel = depth === 0 && mainMenuOpen !== undefined;
  const [localOpen, setLocalOpen] = useState(true);
  const open = isTopLevel ? mainMenuOpen : localOpen;
  const [anchorRect, setAnchorRect] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const hasChildren = !!item.children?.length;
  // Both the collapsed rail and the horizontal bar lack room to expand children in place,
  // so both surface them through the same portal flyout.
  const useFlyout = collapsed || !!horizontal;
  const flyoutOpen = useFlyout && hasChildren && openFlyoutCode === item.code;
  const name = displayName(item, t);
  // A "menu option" is a leaf (no children) — the selected one gets the green dot.
  const isActiveOption = !hasChildren && !!item.routePath && item.routePath === pathname;

  const content = (
    <div
      className={[
        "flex items-center gap-2 rounded-md px-3 py-2 text-sm text-chrome-foreground/80 hover:bg-chrome-surface hover:text-chrome-foreground",
        !hasChildren ? "bg-chrome-foreground/5" : "",
      ].join(" ")}
      style={{ paddingLeft: collapsed ? undefined : 12 + depth * 12 }}
      title={collapsed ? name : undefined}
    >
      <span className="w-5 shrink-0 text-center">{item.icon ?? "•"}</span>
      {!collapsed && <span className="truncate">{name}</span>}
      {!collapsed && hasChildren && (isTopLevel || horizontal) && (
        <span className="ml-auto shrink-0 text-xs text-chrome-foreground/50" aria-hidden="true">
          {horizontal ? (flyoutOpen ? "▲" : "▼") : open ? "▲" : "▼"}
        </span>
      )}
      {!collapsed && isActiveOption && (
        <span className="ml-auto h-2.5 w-2.5 shrink-0 rounded-full bg-success" aria-hidden="true" />
      )}
    </div>
  );

  function handleToggleClick() {
    if (!useFlyout) {
      if (isTopLevel) {
        onToggleMainMenu!();
      } else {
        setLocalOpen((o) => !o);
      }
      return;
    }
    if (flyoutOpen) {
      onOpenFlyout(null);
      return;
    }
    const rect = buttonRef.current?.getBoundingClientRect();
    // Horizontal drops below the bar; the collapsed rail flies out to its right.
    if (rect) {
      setAnchorRect(horizontal ? { top: rect.bottom + 4, left: rect.left } : { top: rect.top, left: rect.right + 4 });
    }
    onOpenFlyout(item.code);
  }

  return (
    <div className="relative">
      {hasChildren ? (
        <button type="button" ref={buttonRef} onClick={handleToggleClick} className="block w-full text-left">
          {content}
        </button>
      ) : item.menuType === "EXTERNAL" && item.externalUrl ? (
        <a
          href={item.externalUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => logSelection(item.code)}
        >
          {content}
        </a>
      ) : item.routePath ? (
        <Link href={item.routePath} onClick={() => logSelection(item.code)} {...linkTargetProps(newWindow)}>
          {content}
        </Link>
      ) : (
        content
      )}
      {hasChildren && open && !useFlyout && (
        <div className={["rounded-md py-1", isTopLevel ? "bg-chrome-surface/20" : "bg-chrome-surface/40"].join(" ")}>
          {item.children!.map((child) => (
            <MenuNode
              key={child.code}
              item={child}
              collapsed={collapsed}
              depth={depth + 1}
              newWindow={newWindow}
              openFlyoutCode={openFlyoutCode}
              onOpenFlyout={onOpenFlyout}
            />
          ))}
        </div>
      )}
      {flyoutOpen && anchorRect && (
        <CollapsedFlyout item={item} anchorRect={anchorRect} newWindow={newWindow} onNavigate={() => onOpenFlyout(null)} />
      )}
    </div>
  );
}

/** Small pill switch — used for the "New window" toggle. */
function ToggleSwitch({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={onChange} className="flex w-full items-center gap-2 px-1 py-1">
      <span
        className={[
          "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
          checked ? "bg-brand-navy" : "bg-chrome-border",
        ].join(" ")}
      >
        <span
          className={[
            "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
            checked ? "translate-x-4" : "translate-x-0.5",
          ].join(" ")}
        />
      </span>
      <span className="truncate text-xs text-chrome-foreground/70">{label}</span>
    </button>
  );
}

export default function Sidebar({
  items,
  collapsed,
  onToggleCollapsed,
  orientation,
  searchTerm,
  newWindow,
  onToggleNewWindow,
}: {
  items: MenuItem[];
  collapsed: boolean;
  onToggleCollapsed: () => void;
  orientation: "vertical" | "horizontal";
  searchTerm: string;
  newWindow: boolean;
  onToggleNewWindow: () => void;
}) {
  const { t } = useLanguage();
  const allItems = [DASHBOARD_ITEM, ...items];
  const navRef = useRef<HTMLElement>(null);
  const [openFlyoutCode, setOpenFlyoutCode] = useState<string | null>(null);
  const pathname = usePathname();
  // Accordion: whichever top-level group contains the active route is open, every
  // other top-level group is collapsed — recomputed on every navigation so selecting
  // a menu option anywhere always collapses whatever else was expanded.
  const [openMainMenu, setOpenMainMenu] = useState<string | null>(() => findActiveTopLevelCode(allItems, pathname));

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpenMainMenu(findActiveTopLevelCode([DASHBOARD_ITEM, ...items], pathname));
  }, [pathname, items]);

  useEffect(() => {
    function handleOutsideClick(e: MouseEvent) {
      const target = e.target as Node;
      // The flyout renders through a portal (to escape the sidebar's clipping scroll
      // container), so it's never inside navRef's actual DOM subtree even though it's
      // logically part of this UI — exclude it explicitly, or a real mousedown on a
      // flyout link fires this handler first and unmounts the flyout (and the very
      // link being clicked) before the click/navigation can complete.
      const insideFlyout = target instanceof Element && target.closest("[data-sidebar-flyout]");
      if (navRef.current && !navRef.current.contains(target) && !insideFlyout) {
        setOpenFlyoutCode(null);
      }
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  const filtered = searchTerm.trim()
    ? allItems.filter((item) => item.name.toLowerCase().includes(searchTerm.trim().toLowerCase()))
    : allItems;

  if (orientation === "horizontal") {
    return (
      <nav
        ref={navRef}
        className="flex items-center gap-1 overflow-x-auto border-b border-chrome-border bg-chrome-background px-2 py-1"
      >
        {filtered.map((item) => (
          <div key={item.code} className="shrink-0">
            <MenuNode
              item={item}
              collapsed={false}
              depth={0}
              newWindow={newWindow}
              openFlyoutCode={openFlyoutCode}
              onOpenFlyout={setOpenFlyoutCode}
              horizontal
            />
          </div>
        ))}
      </nav>
    );
  }

  return (
    <nav
      ref={navRef}
      className={[
        "flex h-full flex-col border-r border-chrome-border bg-chrome-background py-3 transition-[width]",
        collapsed ? "w-16" : "w-64",
      ].join(" ")}
    >
      <div className="mb-2 flex items-center gap-2 px-2">
        <button
          type="button"
          onClick={onToggleCollapsed}
          className="flex w-fit shrink-0 items-center justify-start rounded-md border border-chrome-border px-2 py-1.5 text-xl leading-none text-chrome-foreground/60 hover:bg-chrome-surface"
          title={collapsed ? t("expand") : t("collapse")}
        >
          {collapsed ? "»" : "«"}
        </button>
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <ToggleSwitch checked={newWindow} onChange={onToggleNewWindow} label={t("newWindow")} />
          </div>
        )}
      </div>
      <div className="flex-1 space-y-0.5 overflow-y-auto overflow-x-visible px-2">
        {filtered.map((item) => (
          <MenuNode
            key={item.code}
            item={item}
            collapsed={collapsed}
            depth={0}
            newWindow={newWindow}
            openFlyoutCode={openFlyoutCode}
            onOpenFlyout={setOpenFlyoutCode}
            mainMenuOpen={openMainMenu === item.code}
            onToggleMainMenu={() => setOpenMainMenu((c) => (c === item.code ? null : item.code))}
          />
        ))}
      </div>
    </nav>
  );
}
