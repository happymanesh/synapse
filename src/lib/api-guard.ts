import "server-only";
import { NextResponse } from "next/server";
import { getSession, type SessionPayload } from "@/lib/session";
import { hasMenuAccess } from "@/lib/auth";

/**
 * Menu-gated authorization for API routes.
 *
 * Deliberately returns a response instead of redirecting, unlike `requireMenu()` used by
 * pages: these routes are only ever called by `fetch()`, and a redirect would hand the
 * caller an HTML page that then fails at `res.json()` — the same defect the proxy's
 * UNAUTHORIZED_JSON rule exists to prevent.
 *
 * Lives in lib rather than beside a handler because Next validates the exports of a
 * `route.ts`, so sharing a helper from one would be fragile.
 */
export type MenuGuard = { session: SessionPayload; error?: undefined } | { session?: undefined; error: NextResponse };

export async function guardMenu(menuCode: string, deniedMessage: string): Promise<MenuGuard> {
  const session = await getSession();
  if (!session) {
    return { error: NextResponse.json({ error: "Not authenticated." }, { status: 401 }) };
  }
  if (!(await hasMenuAccess(session.userUid, menuCode))) {
    return { error: NextResponse.json({ error: deniedMessage }, { status: 403 }) };
  }
  return { session };
}
