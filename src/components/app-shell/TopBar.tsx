"use client";

import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LANGUAGES, useLanguage, type LanguageCode } from "@/lib/i18n";
import NotificationBell from "./NotificationBell";
import AppSwitcher, { type AppEntry } from "./AppSwitcher";
import { useMenuUsage } from "./menu-usage";

export type Theme = "day" | "night" | "hybrid";
export type Orientation = "vertical" | "horizontal";

export interface SearchEntry {
  code: string;
  name: string;
  icon?: string;
  routePath?: string;
  menuType?: string;
  externalUrl?: string;
  /** "Menu name and content" search: the full parent chain, e.g. "Utilities › Sample › Sales Report". */
  breadcrumb: string;
}

export default function TopBar({
  fullName,
  hierarchyName,
  companyName,
  companyLogoUrl,
  searchTerm,
  onSearchChange,
  searchIndex,
  theme,
  onThemeChange,
  orientation,
  onOrientationChange,
  language,
  onLanguageChange,
  apps,
  activeApp,
  newWindow,
}: {
  fullName: string;
  hierarchyName: string;
  companyName: string;
  companyLogoUrl: string | null;
  apps: AppEntry[];
  activeApp: AppEntry | null;
  newWindow: boolean;
  searchTerm: string;
  onSearchChange: (value: string) => void;
  searchIndex: SearchEntry[];
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  orientation: Orientation;
  onOrientationChange: (orientation: Orientation) => void;
  language: LanguageCode;
  onLanguageChange: (language: LanguageCode) => void;
}) {
  const router = useRouter();
  const { t } = useLanguage();
  const { logSelection } = useMenuUsage();
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileView, setProfileView] = useState<"menu" | "profile" | "settings">("menu");
  const [searchFocused, setSearchFocused] = useState(false);

  const term = searchTerm.trim().toLowerCase();
  const searchMatches =
    term.length > 0
      ? searchIndex
          .filter((e) => e.name.toLowerCase().includes(term) || e.breadcrumb.toLowerCase().includes(term))
          .slice(0, 8)
      : [];

  function goToEntry(entry: SearchEntry) {
    // Reaching a menu through search still counts as selecting it.
    logSelection(entry.code);
    if (entry.menuType === "EXTERNAL" && entry.externalUrl) {
      window.open(entry.externalUrl, "_blank", "noopener,noreferrer");
    } else if (entry.routePath) {
      router.push(entry.routePath);
    }
    onSearchChange("");
    setSearchFocused(false);
  }

  const pathname = usePathname();
  const activeEntry = searchIndex.find((e) => e.routePath === pathname);
  const [favoriteCodes, setFavoriteCodes] = useState<Set<string>>(new Set());
  const [favoriteBusy, setFavoriteBusy] = useState(false);

  useEffect(() => {
    fetch("/api/favorites")
      .then((res) => (res.ok ? res.json() : []))
      .then((data: { menuCode: string }[]) => setFavoriteCodes(new Set(data.map((f) => f.menuCode))))
      .catch(() => {});
  }, []);

  async function toggleFavorite() {
    if (!activeEntry || favoriteBusy) return;
    setFavoriteBusy(true);
    try {
      const res = await fetch("/api/favorites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ menuCode: activeEntry.code }),
      });
      const data = await res.json();
      if (res.ok) {
        setFavoriteCodes((prev) => {
          const next = new Set(prev);
          if (data.favorited) next.add(activeEntry.code);
          else next.delete(activeEntry.code);
          return next;
        });
      }
    } finally {
      setFavoriteBusy(false);
    }
  }

  const isFavorited = !!activeEntry && favoriteCodes.has(activeEntry.code);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="flex h-14 items-center gap-4 border-b border-chrome-border bg-chrome-background px-4">
      <div className="flex items-center gap-2 font-semibold text-chrome-foreground">
        {/* The company logo is a wordmark that already carries the name, so it replaces the
            text rather than sitting beside it. It keeps a white plate because the asset is a
            JPEG (no transparency) and the chrome turns navy in the night/hybrid themes —
            without the plate it would read as a white slab. Swap in a transparent PNG and
            the plate can go.
            Intrinsic dimensions are passed for the aspect ratio; the height class plus an
            inline width:auto scales it without tripping Next's aspect-ratio warning. */}
        {companyLogoUrl ? (
          <span className="flex items-center rounded-md bg-white px-1.5 py-1">
            <Image
              src={companyLogoUrl}
              alt={companyName}
              width={249}
              height={96}
              priority
              className="h-7 object-contain"
              // Inline rather than a `w-auto` class: next/image's dev aspect-ratio check
              // inspects the inline style attribute, not computed CSS.
              style={{ width: "auto" }}
            />
          </span>
        ) : (
          <span className="hidden text-sm sm:inline">{companyName}</span>
        )}
        <span className="text-chrome-foreground/40">|</span>
        <span className={theme === "day" ? "brand-gradient-text font-extrabold" : "font-extrabold text-brand-teal"}>
          Synapse
        </span>
      </div>

      {activeApp && (
        <div className="flex shrink-0 items-center gap-3">
          <span className="h-5 w-px bg-chrome-border" aria-hidden="true" />
          <span className="flex items-center gap-1.5 text-sm font-semibold text-chrome-foreground/80">
            {activeApp.icon && !activeApp.logoUrl && <span aria-hidden="true">{activeApp.icon}</span>}
            <span className="max-w-[12rem] truncate">{activeApp.name}</span>
          </span>
          <span className="h-5 w-px bg-chrome-border" aria-hidden="true" />
        </div>
      )}

      <div className="relative flex-1">
        <input
          value={searchTerm}
          onChange={(e) => onSearchChange(e.target.value)}
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setTimeout(() => setSearchFocused(false), 150)}
          placeholder={t("searchPlaceholder")}
          className="w-full max-w-xs rounded-md border border-chrome-border bg-chrome-surface px-3 py-1.5 text-sm text-chrome-foreground outline-none focus:border-brand-navy focus:ring-1 focus:ring-brand-navy"
        />
        {searchFocused && searchMatches.length > 0 && (
          <div className="absolute top-full left-0 z-30 mt-1 w-full max-w-xs rounded-md border border-chrome-border bg-chrome-background py-1 shadow-lg">
            {searchMatches.map((entry) => (
              <button
                key={entry.code}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => goToEntry(entry)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-chrome-foreground/80 hover:bg-chrome-surface hover:text-chrome-foreground"
              >
                <span className="w-5 shrink-0 text-center">{entry.icon ?? "•"}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{entry.name}</span>
                  <span className="block truncate text-xs text-chrome-foreground/50">{entry.breadcrumb}</span>
                </span>
              </button>
            ))}
          </div>
        )}
        {searchFocused && term.length > 0 && searchMatches.length === 0 && (
          <div className="absolute top-full left-0 z-30 mt-1 w-full max-w-xs rounded-md border border-chrome-border bg-chrome-background px-3 py-2 text-sm text-chrome-foreground/50 shadow-lg">
            {t("noMatches")}
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          title={
            !activeEntry
              ? "This page isn't a menu item"
              : isFavorited
                ? `Remove "${activeEntry.name}" from favorites`
                : `Add "${activeEntry.name}" to favorites`
          }
          onClick={toggleFavorite}
          disabled={!activeEntry || favoriteBusy}
          className="rounded-full p-2 hover:bg-chrome-surface disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
        >
          {isFavorited ? "❤️" : "🤍"}
        </button>

        <NotificationBell />

        <AppSwitcher apps={apps} activeAppCode={activeApp?.code ?? null} newWindow={newWindow} />

        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setProfileOpen((o) => !o);
              setProfileView("menu");
            }}
            className="flex items-center gap-2 rounded-full py-1 pr-2 pl-1 hover:bg-chrome-surface"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-navy text-xs font-semibold text-white">
              {fullName.charAt(0).toUpperCase()}
            </span>
            <span className="hidden text-left leading-tight sm:block">
              <span className="block text-sm font-medium text-chrome-foreground">{fullName}</span>
              <span className="block text-xs text-chrome-foreground/50">{hierarchyName}</span>
            </span>
          </button>
          {profileOpen && (
            <div className="absolute right-0 z-20 mt-2 w-64 rounded-md border border-chrome-border bg-chrome-background shadow-lg">
              {profileView === "menu" && (
                <div className="p-1">
                  <button
                    type="button"
                    onClick={() => setProfileView("profile")}
                    className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-chrome-foreground/80 hover:bg-chrome-surface"
                  >
                    <span className="w-5 text-center">👤</span>
                    {t("profile")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setProfileView("settings")}
                    className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-chrome-foreground/80 hover:bg-chrome-surface"
                  >
                    <span className="w-5 text-center">⚙️</span>
                    {t("settings")}
                  </button>
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-chrome-foreground/80 hover:bg-chrome-surface"
                  >
                    <span className="w-5 text-center">🚪</span>
                    {t("logout")}
                  </button>
                </div>
              )}

              {profileView === "profile" && (
                <div className="p-3">
                  <button
                    type="button"
                    onClick={() => setProfileView("menu")}
                    className="mb-2 text-xs text-brand-navy hover:underline"
                  >
                    ← {t("back")}
                  </button>
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-navy text-sm font-semibold text-white">
                      {fullName.charAt(0).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-chrome-foreground">{fullName}</p>
                      <p className="truncate text-xs text-chrome-foreground/50">{hierarchyName}</p>
                      <p className="truncate text-xs text-chrome-foreground/50">{companyName}</p>
                    </div>
                  </div>
                </div>
              )}

              {profileView === "settings" && (
                <div className="p-3">
                  <button
                    type="button"
                    onClick={() => setProfileView("menu")}
                    className="mb-2 text-xs text-brand-navy hover:underline"
                  >
                    ← {t("back")}
                  </button>

                  <p className="mb-1 text-xs font-semibold text-chrome-foreground/50 uppercase">{t("theme")}</p>
                  <div className="mb-3 flex gap-1">
                    {(["day", "night", "hybrid"] as Theme[]).map((th) => (
                      <button
                        key={th}
                        type="button"
                        onClick={() => onThemeChange(th)}
                        className={[
                          "flex-1 rounded-md px-2 py-1 text-xs capitalize",
                          theme === th ? "bg-brand-navy text-white" : "bg-chrome-surface text-chrome-foreground/70",
                        ].join(" ")}
                      >
                        {th}
                      </button>
                    ))}
                  </div>

                  <p className="mb-1 text-xs font-semibold text-chrome-foreground/50 uppercase">{t("menuStyle")}</p>
                  <div className="mb-3 flex gap-1">
                    {(["vertical", "horizontal"] as Orientation[]).map((o) => (
                      <button
                        key={o}
                        type="button"
                        onClick={() => onOrientationChange(o)}
                        className={[
                          "flex-1 rounded-md px-2 py-1 text-xs capitalize",
                          orientation === o ? "bg-brand-navy text-white" : "bg-chrome-surface text-chrome-foreground/70",
                        ].join(" ")}
                      >
                        {o}
                      </button>
                    ))}
                  </div>

                  <p className="mb-1 text-xs font-semibold text-chrome-foreground/50 uppercase">{t("language")}</p>
                  <select
                    value={language}
                    onChange={(e) => onLanguageChange(e.target.value as LanguageCode)}
                    className="mb-3 w-full rounded-md border border-chrome-border bg-chrome-surface px-2 py-1 text-xs text-chrome-foreground outline-none focus:border-brand-navy"
                  >
                    {LANGUAGES.map((lang) => (
                      <option key={lang.code} value={lang.code}>
                        {lang.label}
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    className="w-full rounded-md border border-chrome-border px-2 py-1.5 text-xs text-chrome-foreground hover:bg-chrome-surface"
                  >
                    {t("changePassword")}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
