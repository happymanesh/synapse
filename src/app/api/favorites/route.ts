import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  // Favorites follow the app you're in — a favorite from another app would render a card
  // that navigates straight out of the current app's menu tree. The app comes from the
  // caller rather than being re-resolved server-side: the query is already fenced to this
  // user's own rows, so the app is only ever narrowing what they can see anyway, never
  // widening it. Re-deriving it here would repeat the whole roles->menus->apps chain that
  // the layout just ran. Blank/absent means "no app scoping" — show everything.
  const appCode = request.nextUrl.searchParams.get("app") || null;

  const favorites = await prisma.userFavoriteMenu.findMany({
    where: {
      userUid: session.userUid,
      ...(appCode ? { menu: { OR: [{ appCode }, { appCode: null }] } } : {}),
    },
    orderBy: { createdOn: "desc" },
    include: { menu: true },
  });

  return NextResponse.json(
    favorites.map((f) => ({
      menuCode: f.menu.menuCode,
      name: f.menu.menuName,
      icon: f.menu.icon,
      routePath: f.menu.menuType === "REPORT" && f.menu.reportId ? `/reports/${f.menu.reportId}` : f.menu.routePath,
      menuType: f.menu.menuType,
      externalUrl: f.menu.externalUrl,
    }))
  );
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const menuCode = typeof body?.menuCode === "string" ? body.menuCode : "";
  if (!menuCode) {
    return NextResponse.json({ error: "menuCode is required." }, { status: 400 });
  }

  const existing = await prisma.userFavoriteMenu.findUnique({
    where: { userUid_menuCode: { userUid: session.userUid, menuCode } },
  });

  if (existing) {
    await prisma.userFavoriteMenu.delete({ where: { id: existing.id } });
    return NextResponse.json({ favorited: false });
  }

  try {
    await prisma.userFavoriteMenu.create({ data: { userUid: session.userUid, menuCode } });
    return NextResponse.json({ favorited: true });
  } catch {
    return NextResponse.json({ error: "That menu item doesn't exist." }, { status: 400 });
  }
}
