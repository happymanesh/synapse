/**
 * Pure request-gating rules: what an unauthenticated request should get back.
 *
 * Deliberately free of `server-only` and of any `next/server` import so it can be unit
 * tested directly (see tests/auth-core.test.ts). `src/proxy.ts` is the thin adapter that
 * turns these decisions into actual responses.
 *
 * The rule that matters here: a browser navigation gets redirected to the login page, but an
 * API call gets a 401 with a JSON body. Redirecting an API call sends back an HTML login
 * page, which every `fetch` caller in this app then tries to parse as JSON — so a plain
 * expired session surfaces as an unexplained parse failure rather than "please sign in".
 */

export const PUBLIC_ROUTES = ["/login"];

export type ProxyDecision =
  | "ALLOW"
  | "REDIRECT_TO_LOGIN"
  | "REDIRECT_TO_DASHBOARD"
  | "UNAUTHORIZED_JSON";

export function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

/**
 * Whether this path is an API endpoint rather than a page.
 *
 * `/api/auth/*` is excluded from the proxy by its matcher config, not here — keeping that
 * exclusion in one place avoids two definitions of "public API" drifting apart.
 */
export function isApiRoute(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

export function decideProxyAction(pathname: string, authenticated: boolean): ProxyDecision {
  if (!isPublicRoute(pathname) && !authenticated) {
    return isApiRoute(pathname) ? "UNAUTHORIZED_JSON" : "REDIRECT_TO_LOGIN";
  }
  // Only the login page itself bounces an already-signed-in user onward; a nested public
  // path under /login must not, or it would become unreachable while signed in.
  if (pathname === "/login" && authenticated) {
    return "REDIRECT_TO_DASHBOARD";
  }
  return "ALLOW";
}

/** Body returned for UNAUTHORIZED_JSON. Matches the `{ error }` shape every route handler
 * and every client error path in this app already expects. */
export const SESSION_EXPIRED_BODY = {
  error: "Your session has expired. Please sign in again.",
} as const;
