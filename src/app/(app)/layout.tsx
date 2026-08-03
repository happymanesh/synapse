import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import AppShellClient from "@/components/app-shell/AppShellClient";
import { getUserShellContext } from "@/lib/user-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  // One pass resolves apps, the active app and the app-scoped menu tree together —
  // see getUserShellContext for why composing the individual helpers is wasteful here.
  const [{ apps, activeApp, menuItems }, company] = await Promise.all([
    getUserShellContext(session.userUid),
    prisma.companyMaster.findUnique({
      where: { companyCode: session.companyCode },
      select: { companyName: true, companyLogoFileLocation: true },
    }),
  ]);

  return (
    <AppShellClient
      fullName={session.fullName}
      hierarchyName={session.hierarchyName}
      companyName={company?.companyName ?? session.companyCode}
      companyLogoUrl={company?.companyLogoFileLocation ?? null}
      menuItems={menuItems}
      apps={apps}
      activeApp={activeApp}
    >
      {children}
    </AppShellClient>
  );
}
