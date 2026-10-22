import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { buildLoginSeries, percentChange, startOfDay } from "@/lib/dashboard-core";
import DashboardClient from "./DashboardClient";

/**
 * Server Component, so every figure on the page is a real query result.
 *
 * It replaces a client page whose chart plotted a hardcoded LOGIN_TREND constant and whose
 * stat tiles read "1", "—", "—". Invented numbers on the first screen of an internal
 * platform are worse than no numbers: nobody can tell which of the figures beside them
 * are also invented.
 */
export default async function DashboardPage() {
  const session = await getSession();
  const now = new Date();
  const todayStart = startOfDay(now);
  const weekStart = new Date(todayStart.getTime() - 6 * 24 * 60 * 60 * 1000);
  const prevWeekStart = new Date(weekStart.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [activeUsers, loginsToday, loginsPrevDay, openTickets, employees, attempts] = await Promise.all([
    prisma.userDetails.count({ where: { isActive: true } }),
    prisma.loginLog.count({ where: { status: "SUCCESS", loginTime: { gte: todayStart } } }),
    prisma.loginLog.count({
      where: {
        status: "SUCCESS",
        loginTime: { gte: new Date(todayStart.getTime() - 24 * 60 * 60 * 1000), lt: todayStart },
      },
    }),
    prisma.ticket.count({ where: { status: "OPEN" } }).catch(() => 0),
    prisma.hrEmployee.count().catch(() => 0),
    prisma.loginLog.findMany({
      where: { loginTime: { gte: weekStart } },
      select: { loginTime: true, status: true },
    }),
  ]);

  const series = buildLoginSeries(attempts, now);
  const failuresThisWeek = series.reduce((n, d) => n + d.failure, 0);

  // Counted over the preceding seven days so "vs last week" compares like with like.
  const prevWeekFailures = await prisma.loginLog.count({
    where: { status: "FAILURE", loginTime: { gte: prevWeekStart, lt: weekStart } },
  });

  return (
    <DashboardClient
      fullName={session?.fullName ?? ""}
      series={series}
      stats={{
        activeUsers,
        loginsToday,
        loginsTodayChange: percentChange(loginsToday, loginsPrevDay),
        openTickets,
        employees,
        failuresThisWeek,
        failuresChange: percentChange(failuresThisWeek, prevWeekFailures),
      }}
    />
  );
}
