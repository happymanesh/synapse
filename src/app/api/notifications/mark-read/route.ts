import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const ids = Array.isArray(body?.ids) ? body.ids.filter((id: unknown) => typeof id === "number") : [];
  if (ids.length === 0) {
    return NextResponse.json({ success: true });
  }

  await prisma.notificationRead.createMany({
    data: ids.map((notificationId: number) => ({ notificationId, userUid: session.userUid })),
    skipDuplicates: true,
  });

  return NextResponse.json({ success: true });
}
