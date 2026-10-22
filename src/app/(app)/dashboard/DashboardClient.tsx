"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { useLanguage } from "@/lib/i18n";
import { useActiveAppCode } from "@/components/app-shell/active-app";
import type { LoginDayPoint } from "@/lib/dashboard-core";

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

export interface DashboardStats {
  activeUsers: number;
  loginsToday: number;
  loginsTodayChange: number | null;
  openTickets: number;
  employees: number;
  failuresThisWeek: number;
  failuresChange: number | null;
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
    <section>
      <h2 className="mb-2.5 text-xs font-semibold tracking-wide text-foreground/55 uppercase">{title}</h2>
      <div className="flex gap-2.5 overflow-x-auto pb-1">
        {entries.map((entry) => {
          const card = (
            <div className="flex h-[4.5rem] w-44 shrink-0 items-center gap-3 rounded-lg border border-border bg-card px-3.5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-brand-navy/40 hover:shadow-md">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-surface text-lg">
                {entry.icon ?? fallbackIcon}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{entry.name}</p>
                {showCount && entry.count !== undefined && (
                  <p className="text-xs text-foreground/50">{entry.count}&times;</p>
                )}
              </div>
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
    </section>
  );
}

/** A figure plus, where there is a real baseline to compare against, how it moved. */
function StatTile({
  label,
  value,
  change,
  invertChange,
}: {
  label: string;
  value: number | string;
  change?: number | null;
  /** For figures where up is bad — failed sign-ins. */
  invertChange?: boolean;
}) {
  const good = change == null ? null : invertChange ? change <= 0 : change >= 0;
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <p className="text-xs font-medium tracking-wide text-foreground/50 uppercase">{label}</p>
      <div className="mt-1.5 flex items-baseline gap-2">
        <p className="text-2xl font-semibold tabular-nums text-foreground">{value}</p>
        {change != null && (
          <span className={`text-xs font-medium ${good ? "text-success" : "text-danger"}`}>
            {change > 0 ? "+" : ""}
            {change}%
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Recharts writes stroke as an SVG presentation attribute, where `var(--x)` does not
 * resolve — so the themed values have to be read off the document and re-read whenever
 * the theme changes (AppShellClient stamps data-theme on <html>).
 */
function useChartColors(): { success: string; danger: string; grid: string; muted: string } {
  const [colors, setColors] = useState({
    success: "#1d8f6a",
    danger: "#c0342b",
    grid: "#e2ecf4",
    muted: "#5c6e80",
  });

  useEffect(() => {
    const read = () => {
      const s = getComputedStyle(document.documentElement);
      const next = {
        success: s.getPropertyValue("--success").trim(),
        danger: s.getPropertyValue("--danger").trim(),
        grid: s.getPropertyValue("--border-color").trim(),
        muted: s.getPropertyValue("--brand-muted").trim(),
      };
      if (next.success && next.danger) setColors(next);
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  return colors;
}

export default function DashboardClient({
  fullName,
  series,
  stats,
}: {
  fullName: string;
  series: LoginDayPoint[];
  stats: DashboardStats;
}) {
  const { t } = useLanguage();
  const [favorites, setFavorites] = useState<MenuCardEntry[] | null>(null);
  const [topMenus, setTopMenus] = useState<MenuCardEntry[] | null>(null);
  const activeAppCode = useActiveAppCode();
  const colors = useChartColors();

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

  const firstName = fullName.split(" ")[0];

  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            {firstName ? `${t("dashboard")} — ${firstName}` : t("dashboard")}
          </h1>
          <p className="mt-0.5 text-sm text-foreground/55">{t("dashboardSubtitle")}</p>
        </div>
        <p className="text-sm tabular-nums text-foreground/50">
          {new Date().toLocaleDateString(undefined, {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric",
          })}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label={t("activeUsers")} value={stats.activeUsers} />
        <StatTile label={t("loginsToday")} value={stats.loginsToday} change={stats.loginsTodayChange} />
        <StatTile label={t("pendingHelpRequests")} value={stats.openTickets} />
        <StatTile
          label={t("employees")}
          value={stats.employees}
        />
      </div>

      <MenuCardStrip title={t("favorites")} entries={favorites} fallbackIcon="⭐" />
      <MenuCardStrip title={t("frequentlyUsed")} entries={topMenus} fallbackIcon="📌" showCount />

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h2 className="mb-5 text-xs font-semibold tracking-wide text-foreground/55 uppercase">
          {t("loginActivity")}
        </h2>
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            {/* Success and failure share one axis deliberately — they are the same unit
                (attempts), so a second scale would misrepresent their relative size. */}
            <AreaChart data={series} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
              <defs>
                <linearGradient id="fillSuccess" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={colors.success} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={colors.success} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="fillFailure" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={colors.danger} stopOpacity={0.18} />
                  <stop offset="100%" stopColor={colors.danger} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} vertical={false} />
              <XAxis
                dataKey="day"
                tick={{ fontSize: 11, fill: colors.muted }}
                stroke={colors.grid}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: colors.muted }}
                stroke={colors.grid}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
                width={44}
              />
              <Tooltip
                contentStyle={{
                  fontSize: 12,
                  borderRadius: 8,
                  border: `1px solid ${colors.grid}`,
                  background: "var(--card)",
                  color: "var(--foreground)",
                }}
                labelFormatter={(_label, payload) => payload?.[0]?.payload?.date ?? ""}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} iconType="plainline" />
              <Area
                type="monotone"
                dataKey="success"
                name={t("success")}
                stroke={colors.success}
                strokeWidth={2}
                fill="url(#fillSuccess)"
                dot={false}
                activeDot={{ r: 4 }}
              />
              <Area
                type="monotone"
                dataKey="failure"
                name={t("failure")}
                stroke={colors.danger}
                strokeWidth={2}
                fill="url(#fillFailure)"
                dot={false}
                activeDot={{ r: 4 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </section>
    </div>
  );
}
