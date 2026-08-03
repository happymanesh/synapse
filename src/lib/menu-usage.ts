import { prisma } from "@/lib/db";

export const MENU_USAGE_RETENTION_DAYS = 7;

function retentionCutoff(): Date {
  return new Date(Date.now() - MENU_USAGE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * Throttle for the retention purge. There is no cron in this app (same reasoning as
 * notification scheduling — see CLAUDE.md), so old rows are trimmed opportunistically on
 * the write path, at most once an hour per server process. Reads don't rely on this: they
 * filter by the cutoff themselves, so the 7-day window is correct even if a purge is late.
 */
let lastPurgeAt = 0;
const PURGE_INTERVAL_MS = 60 * 60 * 1000;

export interface MenuSelection {
  userUid: number;
  username: string;
  companyCode: string;
  appCode: string | null;
  menuCode: string;
  menuName: string;
  mainMenu: string | null;
  subMenu: string | null;
  routePath: string | null;
}

/** Single unconstrained INSERT — this sits on the click path, so it must stay cheap. */
export async function recordMenuSelection(selection: MenuSelection): Promise<void> {
  await prisma.menuUsageLog.create({ data: selection });

  const now = Date.now();
  if (now - lastPurgeAt < PURGE_INTERVAL_MS) return;
  lastPurgeAt = now;
  await prisma.menuUsageLog
    .deleteMany({ where: { selectedAt: { lt: retentionCutoff() } } })
    .catch(() => {
      // Never let housekeeping fail the request that happened to trigger it; the next
      // write an hour later will try again.
    });
}

export interface TopMenuEntry {
  menuCode: string;
  name: string;
  icon: string | null;
  routePath: string | null;
  menuType: string;
  externalUrl: string | null;
  count: number;
}

/**
 * The user's most-selected menus over the retention window, scoped to the app they're in.
 *
 * Counts group by menuCode rather than by the denormalised name, so renaming a menu doesn't
 * split its history; display fields then come from menu_master, which also drops entries for
 * menus that have since been deleted or deactivated.
 */
export async function getTopMenus(
  userUid: number,
  appCode: string | null,
  limit = 5
): Promise<TopMenuEntry[]> {
  const grouped = await prisma.menuUsageLog.groupBy({
    by: ["menuCode"],
    where: {
      userUid,
      selectedAt: { gte: retentionCutoff() },
      ...(appCode ? { appCode } : {}),
    },
    _count: { menuCode: true },
    orderBy: { _count: { menuCode: "desc" } },
    // Over-fetch: some of these may point at menus that no longer exist, and we still
    // want `limit` live entries after filtering.
    take: limit * 3,
  });
  if (grouped.length === 0) return [];

  const menus = await prisma.menuMaster.findMany({
    where: { menuCode: { in: grouped.map((g) => g.menuCode) }, isActive: true },
    select: { menuCode: true, menuName: true, icon: true, routePath: true, menuType: true, externalUrl: true, reportId: true },
  });
  const byCode = new Map(menus.map((m) => [m.menuCode, m]));

  return grouped
    .filter((g) => byCode.has(g.menuCode))
    .slice(0, limit)
    .map((g) => {
      const m = byCode.get(g.menuCode)!;
      return {
        menuCode: m.menuCode,
        name: m.menuName,
        icon: m.icon,
        routePath: m.menuType === "REPORT" && m.reportId ? `/reports/${m.reportId}` : m.routePath,
        menuType: m.menuType,
        externalUrl: m.externalUrl,
        count: g._count.menuCode,
      };
    });
}
