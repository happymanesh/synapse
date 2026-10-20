import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import {
  CHANGE_PASSWORD_ROUTE,
  decideProxyAction,
  PASSWORD_CHANGE_REQUIRED_BODY,
  SESSION_EXPIRED_BODY,
} from "@/lib/auth-core";

const SESSION_COOKIE = "synapse_session";

const encodedKey = new TextEncoder().encode(process.env.SESSION_SECRET);

/** Whether the request carries a valid session, and whether that session is still waiting
 * for a first-login password change (a claim set at sign-in, see api/auth/login). */
async function readSession(request: NextRequest): Promise<{ authenticated: boolean; mustChangePassword: boolean }> {
  const cookie = request.cookies.get(SESSION_COOKIE)?.value;
  if (!cookie) return { authenticated: false, mustChangePassword: false };
  try {
    const { payload } = await jwtVerify(cookie, encodedKey, { algorithms: ["HS256"] });
    return { authenticated: true, mustChangePassword: payload.mustChangePassword === true };
  } catch {
    return { authenticated: false, mustChangePassword: false };
  }
}

/**
 * Thin adapter: the decision itself lives in `@/lib/auth-core` so it can be unit tested
 * without a NextRequest. This function only turns a decision into a response.
 */
export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const { authenticated, mustChangePassword } = await readSession(request);

  switch (decideProxyAction(pathname, authenticated, mustChangePassword)) {
    case "PASSWORD_CHANGE_REQUIRED_JSON":
      return NextResponse.json(PASSWORD_CHANGE_REQUIRED_BODY, { status: 403 });
    case "REDIRECT_TO_CHANGE_PASSWORD":
      return NextResponse.redirect(new URL(CHANGE_PASSWORD_ROUTE, request.url));
    case "UNAUTHORIZED_JSON":
      // An API caller gets JSON it can actually read. Redirecting here would hand a
      // `fetch()` an HTML login page, which then fails at res.json() and surfaces as a
      // generic network error instead of an expired session.
      return NextResponse.json(SESSION_EXPIRED_BODY, { status: 401 });
    case "REDIRECT_TO_LOGIN":
      return NextResponse.redirect(new URL("/login", request.url));
    case "REDIRECT_TO_DASHBOARD":
      return NextResponse.redirect(new URL("/dashboard", request.url));
    case "ALLOW":
      return NextResponse.next();
  }
}

export const config = {
  // Static assets in /public (logos, icons, downloadable docs, etc.) must always be
  // reachable — including by Next's own image optimizer fetching them internally,
  // which happens unauthenticated on pages like /login.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/auth|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|avif|css|js|pdf)$).*)",
  ],
};
