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
  | "UNAUTHORIZED_JSON"
  | "REDIRECT_TO_CHANGE_PASSWORD"
  | "PASSWORD_CHANGE_REQUIRED_JSON";

/**
 * The one page a user who must change their password may open. The change itself is
 * POST /api/auth/change-password, which (like all of /api/auth) is outside the proxy.
 */
export const CHANGE_PASSWORD_ROUTE = "/change-password";

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

/**
 * `mustChangePassword` comes from the session token (set at sign-in for a user flagged
 * must_change_password). While it is set, every page except the change-password page
 * redirects there and every API call is refused — so a first-login user can do nothing until
 * they have replaced the password they were given.
 */
export function decideProxyAction(pathname: string, authenticated: boolean, mustChangePassword = false): ProxyDecision {
  if (!isPublicRoute(pathname) && !authenticated) {
    return isApiRoute(pathname) ? "UNAUTHORIZED_JSON" : "REDIRECT_TO_LOGIN";
  }
  if (authenticated && mustChangePassword) {
    if (pathname === CHANGE_PASSWORD_ROUTE) return "ALLOW";
    return isApiRoute(pathname) ? "PASSWORD_CHANGE_REQUIRED_JSON" : "REDIRECT_TO_CHANGE_PASSWORD";
  }
  // Nothing to do on the forced-change page once the password has been changed.
  if (pathname === CHANGE_PASSWORD_ROUTE && authenticated) return "REDIRECT_TO_DASHBOARD";
  // Only the login page itself bounces an already-signed-in user onward; a nested public
  // path under /login must not, or it would become unreachable while signed in.
  if (pathname === "/login" && authenticated) {
    return "REDIRECT_TO_DASHBOARD";
  }
  return "ALLOW";
}

/** Body returned for PASSWORD_CHANGE_REQUIRED_JSON. */
export const PASSWORD_CHANGE_REQUIRED_BODY = {
  error: "You must change your password before continuing.",
} as const;

/** Body returned for UNAUTHORIZED_JSON. Matches the `{ error }` shape every route handler
 * and every client error path in this app already expects. */
export const SESSION_EXPIRED_BODY = {
  error: "Your session has expired. Please sign in again.",
} as const;

// ---------------------------------------------------------------------------
// Account usability
// ---------------------------------------------------------------------------

/**
 * Why an account may not be used, or null if it may. The ONE rule both login
 * (api/auth/login) and every request (getSession) apply, so they cannot drift apart.
 *
 * Suspension is separate from deactivation: a suspended account keeps is_active = true and
 * is restorable — today it is set and lifted by the HR lifecycle when HR freezes/unfreezes
 * an employee (src/lib/hr/lifecycle). Deactivation is the permanent "this person has left".
 */
export type AccountBlock = "INACTIVE" | "SUSPENDED";

export function accountBlock(user: { isActive: boolean; isSuspended: boolean }): AccountBlock | null {
  if (!user.isActive) return "INACTIVE";
  if (user.isSuspended) return "SUSPENDED";
  return null;
}
