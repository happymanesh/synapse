"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Line, LineChart, CartesianGrid, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { useLanguage } from "@/lib/i18n";
import { useActiveAppCode } from "@/components/app-shell/active-app";

interface MenuCardEntry {
  menuCode: string;
  name: string;
  icon: string | null;
  routePath: string | null;
  menuType: string;
  externalUrl: string | null;
  /** Only present on "Frequently used" entries — how many times it was opened in the retention window. */
  count?: number;
}

/**
 * Horizontally scrolling strip of menu shortcuts. Shared by Favorites and Frequently used
 * options so the two read as one family; the only difference is the title, the fallback
 * icon, and whether a usage count is shown.
 */
function MenuCardStrip({
  title,
  entries,
  fallbackIcon,
  showCount,
}: {
  title: string;
  entries: MenuCardEntry[] | null;
  fallbackIcon: string;
  showCount?: boolean;
}) {
  if (!entries || entries.length === 0) return null;
  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold text-foreground/80">{title}</h2>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {entries.map((entry) => {
          const card = (
            <div className="flex h-24 w-40 shrink-0 flex-col justify-between rounded-lg border border-border bg-card p-3 shadow-sm transition hover:border-brand-navy/40 hover:shadow-md">
              <div className="flex items-start justify-between gap-2">
                <span className="text-2xl">{entry.icon ?? fallbackIcon}</span>
                {showCount && entry.count !== undefined && (
                  <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-foreground/60">
                    {entry.count}
                  </span>
                )}
              </div>
              <span className="truncate text-sm font-medium text-foreground">{entry.name}</span>
            </div>
          );
          return entry.menuType === "EXTERNAL" && entry.externalUrl ? (
            <a key={entry.menuCode} href={entry.externalUrl} target="_blank" rel="noopener noreferrer">
              {card}
            </a>
          ) : entry.routePath ? (
            <Link key={entry.menuCode} href={entry.routePath}>
              {card}
            </Link>
          ) : (
            <div key={entry.menuCode}>{card}</div>
          );
        })}
      </div>
    </div>
  );
}

// Placeholder trend data — real login_logs-backed analytics land in a later phase.
const LOGIN_TREND = [
  { day: "Mon", success: 42, failure: 3 },
  { day: "Tue", success: 51, failure: 2 },
  { day: "Wed", success: 47, failure: 5 },
  { day: "Thu", success: 60, failure: 1 },
  { day: "Fri", success: 58, failure: 4 },
  { day: "Sat", success: 20, failure: 0 },
  { day: "Sun", success: 15, failure: 1 },
];

/**
 * Recharts writes stroke as an SVG presentation attribute, where `var(--x)` does not
 * resolve — so the themed values have to be read off the document and re-read whenever
 * the theme changes (AppShellClient stamps data-theme on <html>).
 */
function useChartColors(): { chart1: string; chart2: string } {
  const [colors, setColors] = useState({ chart1: "#1c5fa0", chart2: "#c98a1f" });

  useEffect(() => {
    const read = () => {
      const style = getComputedStyle(document.documentElement);
      const chart1 = style.getPropertyValue("--chart-1").trim();
      const chart2 = style.getPropertyValue("--chart-2").trim();
      if (chart1 && chart2) setColors({ chart1, chart2 });
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  return colors;
}

export default function DashboardPage() {
  const { t } = useLanguage();
  const STAT_TILES = [
    { label: t("activeUsers"), value: "1" },
    { label: t("loginsToday"), value: "—" },
    { label: t("pendingHelpRequests"), value: "—" },
  ];
  const [favorites, setFavorites] = useState<MenuCardEntry[] | null>(null);
  const [topMenus, setTopMenus] = useState<MenuCardEntry[] | null>(null);
  const activeAppCode = useActiveAppCode();
  const { chart1, chart2 } = useChartColors();

  useEffect(() => {
    const app = encodeURIComponent(activeAppCode ?? "");
    fetch(`/api/favorites?app=${app}`)
      .then((res) => (res.ok ? res.json() : []))
      .then(setFavorites)
      .catch(() => setFavorites([]));
    fetch(`/api/menu-usage/top?app=${app}`)
      .then((res) => (res.ok ? res.json() : []))
      .then(setTopMenus)
      .catch(() => setTopMenus([]));
  }, [activeAppCode]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">{t("dashboard")}</h1>
        <p className="text-sm text-foreground/60">{t("dashboardSubtitle")}</p>
      </div>

      <MenuCardStrip title={t("favorites")} entries={favorites} fallbackIcon="⭐" />
      <MenuCardStrip title={t("frequentlyUsed")} entries={topMenus} fallbackIcon="📌" showCount />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {STAT_TILES.map((tile) => (
          <div key={tile.label} className="rounded-lg border border-border bg-card p-4 shadow-sm">
            <p className="text-xs font-medium text-foreground/50 uppercase">{tile.label}</p>
            <p className="mt-1 text-2xl font-semibold text-foreground">{tile.value}</p>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold text-foreground/80">{t("loginActivity")}</h2>
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={LOGIN_TREND} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" vertical={false} />
              <XAxis dataKey="day" tick={{ fontSize: 12 }} stroke="var(--border-color)" />
              <YAxis tick={{ fontSize: 12 }} stroke="var(--border-color)" allowDecimals={false} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="success" name={t("success")} stroke={chart1} strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="failure" name={t("failure")} stroke={chart2} strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
