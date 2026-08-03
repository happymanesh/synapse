import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { getAppsForUser } from "@/lib/apps";

/** Remembers the app the user just switched to, so their next login reopens it. */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const appCode = typeof body?.appCode === "string" ? body.appCode : "";
  if (!appCode) {
    return NextResponse.json({ error: "appCode is required." }, { status: 400 });
  }

  // Only persist an app this user can actually reach — otherwise a crafted request
  // could park them on an app whose menus they'd never be shown anyway.
  const apps = await getAppsForUser(session.userUid);
  if (!apps.some((a) => a.code === appCode)) {
    return NextResponse.json({ error: "You don't have access to that app." }, { status: 403 });
  }

  await prisma.userDetails.update({ where: { uid: session.userUid }, data: { lastAppCode: appCode } });
  return NextResponse.json({ success: true });
}
