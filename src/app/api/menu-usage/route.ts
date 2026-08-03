import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { recordMenuSelection } from "@/lib/menu-usage";

/**
 * Records one menu selection. Called fire-and-forget from the client, so the response body
 * is intentionally trivial — nothing waits on it.
 *
 * The menu's own details (name, position in the tree) come from the caller because the
 * client already holds the resolved menu tree; re-deriving them here would mean running the
 * roles->menus chain on every click, which is exactly the cost this design avoids. Nothing
 * here is a trust boundary: a user can only ever write log rows attributed to themselves
 * (identity comes from the session, never the body), and the log has no authorization role.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const menuCode = typeof body?.menuCode === "string" ? body.menuCode : "";
  const menuName = typeof body?.menuName === "string" ? body.menuName : "";
  if (!menuCode || !menuName) {
    return NextResponse.json({ error: "menuCode and menuName are required." }, { status: 400 });
  }

  const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

  try {
    await recordMenuSelection({
      userUid: session.userUid,
      username: session.username,
      companyCode: session.companyCode,
      appCode: str(body?.appCode),
      menuCode,
      menuName,
      mainMenu: str(body?.mainMenu),
      subMenu: str(body?.subMenu),
      routePath: str(body?.routePath),
    });
  } catch {
    // Usage logging must never surface as a user-visible failure.
    return NextResponse.json({ ok: false });
  }

  return NextResponse.json({ ok: true });
}
