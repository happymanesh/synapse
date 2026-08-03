import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";

/**
 * A notification has no fixed recipient list — it resolves at read time to either a
 * direct user match or a hierarchy match. scheduledFor needs no worker: a message
 * simply doesn't show up here until its scheduled time has passed (or immediately,
 * if left blank). See CLAUDE.md "Notifications" rule.
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const now = new Date();
  const notifications = await prisma.notification.findMany({
    where: {
      isActive: true,
      AND: [
        { OR: [{ scheduledFor: null }, { scheduledFor: { lte: now } }] },
        {
          OR: [
            { targetType: "USER", targetUserUid: session.userUid },
            { targetType: "HIERARCHY", targetHierarchyCode: session.hierarchyCode },
          ],
        },
      ],
    },
    orderBy: { createdAt: "desc" },
  });

  const reads = await prisma.notificationRead.findMany({
    where: { userUid: session.userUid, notificationId: { in: notifications.map((n) => n.id) } },
    select: { notificationId: true },
  });
  const readIds = new Set(reads.map((r) => r.notificationId));

  return NextResponse.json(
    notifications.map((n) => ({
      id: n.id,
      messageText: n.messageText,
      createdAt: n.createdAt,
      deliveryPopup: n.deliveryPopup,
      deliveryBell: n.deliveryBell,
      read: readIds.has(n.id),
    }))
  );
}
