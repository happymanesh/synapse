import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getTopMenus } from "@/lib/menu-usage";

/** The signed-in user's most-used menu options, for the dashboard strip under Favorites. */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  // Same convention as /api/favorites: the app is supplied by the caller rather than
  // re-resolved, since it only narrows the current user's own rows.
  const appCode = request.nextUrl.searchParams.get("app") || null;
  const top = await getTopMenus(session.userUid, appCode);
  return NextResponse.json(top);
}
