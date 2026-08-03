import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import NotificationsClient from "./NotificationsClient";

export default async function NotificationsAdminPage() {
  const [notifications, hierarchies, users, session] = await Promise.all([
    prisma.notification.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.hierarchyMaster.findMany({
      where: { isActive: true },
      select: { hierarchyCode: true, hierarchyName: true },
      orderBy: { seqId: "asc" },
    }),
    prisma.userDetails.findMany({
      where: { isActive: true },
      select: { uid: true, fullName: true, username: true },
      orderBy: { fullName: "asc" },
    }),
    getSession(),
  ]);

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-foreground">Notifications</h1>
      <p className="mb-4 text-sm text-foreground/60">
        Sends a message to a whole hierarchy or one specific user. Delivery can be a popup shown on the recipient&apos;s
        next login, listed in their notification bell, or both. A scheduled date/time holds the message back — the
        recipient simply won&apos;t see it until then, with no separate send step required.
      </p>
      <NotificationsClient notifications={notifications} hierarchies={hierarchies} users={users} currentUsername={session!.username} />
    </div>
  );
}
