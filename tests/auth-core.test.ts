import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { accountBlock, CHANGE_PASSWORD_ROUTE, decideProxyAction, isApiRoute, isPublicRoute } from "../src/lib/auth-core";

describe("isPublicRoute", () => {
  test("the login page and paths under it are public", () => {
    assert.equal(isPublicRoute("/login"), true);
    assert.equal(isPublicRoute("/login/help"), true);
  });

  test("a path merely starting with the same letters is not public", () => {
    // "/loginsomething" must not inherit /login's public status.
    assert.equal(isPublicRoute("/loginsomething"), false);
  });

  test("everything else is protected", () => {
    for (const p of ["/dashboard", "/admin/users", "/support/tickets", "/"]) {
      assert.equal(isPublicRoute(p), false, p);
    }
  });
});

describe("isApiRoute", () => {
  test("recognises API paths", () => {
    assert.equal(isApiRoute("/api"), true);
    assert.equal(isApiRoute("/api/tickets"), true);
    assert.equal(isApiRoute("/api/admin/users/3"), true);
  });

  test("does not treat a page path that merely contains 'api' as an API route", () => {
    assert.equal(isApiRoute("/apidocs"), false);
    assert.equal(isApiRoute("/support/api-guide"), false);
  });
});

describe("decideProxyAction", () => {
  test("an unauthenticated page request is redirected to the login page", () => {
    assert.equal(decideProxyAction("/dashboard", false), "REDIRECT_TO_LOGIN");
    assert.equal(decideProxyAction("/support/tickets", false), "REDIRECT_TO_LOGIN");
  });

  test("an unauthenticated API request gets a JSON 401, never a redirect", () => {
    // The bug this rule exists to prevent: a redirect hands fetch() an HTML login page,
    // which throws at res.json() and surfaces as a generic network error rather than
    // telling the user their session expired.
    assert.equal(decideProxyAction("/api/tickets", false), "UNAUTHORIZED_JSON");
    assert.equal(decideProxyAction("/api/admin/users", false), "UNAUTHORIZED_JSON");
    assert.equal(decideProxyAction("/api/notifications", false), "UNAUTHORIZED_JSON");
  });

  test("an authenticated request is allowed through", () => {
    for (const p of ["/dashboard", "/api/tickets", "/support/tickets"]) {
      assert.equal(decideProxyAction(p, true), "ALLOW", p);
    }
  });

  test("an unauthenticated visitor may reach the login page", () => {
    assert.equal(decideProxyAction("/login", false), "ALLOW");
  });

  test("an authenticated user on the login page is sent to the dashboard", () => {
    assert.equal(decideProxyAction("/login", true), "REDIRECT_TO_DASHBOARD");
  });

  test("a nested public path stays reachable while signed in", () => {
    // Only /login itself bounces onward — /login/help must not become unreachable.
    assert.equal(decideProxyAction("/login/help", true), "ALLOW");
  });
});

describe("accountBlock", () => {
  test("active and not suspended may sign in", () => {
    assert.equal(accountBlock({ isActive: true, isSuspended: false }), null);
  });
  test("suspended is blocked, but distinguishable from inactive", () => {
    assert.equal(accountBlock({ isActive: true, isSuspended: true }), "SUSPENDED");
  });
  test("inactive wins over suspended", () => {
    assert.equal(accountBlock({ isActive: false, isSuspended: true }), "INACTIVE");
    assert.equal(accountBlock({ isActive: false, isSuspended: false }), "INACTIVE");
  });
});

describe("first-login password change (proxy)", () => {
  test("every page redirects to the change-password page, every API is refused", () => {
    assert.equal(decideProxyAction("/dashboard", true, true), "REDIRECT_TO_CHANGE_PASSWORD");
    assert.equal(decideProxyAction("/admin/users", true, true), "REDIRECT_TO_CHANGE_PASSWORD");
    assert.equal(decideProxyAction("/login", true, true), "REDIRECT_TO_CHANGE_PASSWORD");
    assert.equal(decideProxyAction("/api/notifications", true, true), "PASSWORD_CHANGE_REQUIRED_JSON");
  });

  test("the change-password page itself is allowed", () => {
    assert.equal(decideProxyAction(CHANGE_PASSWORD_ROUTE, true, true), "ALLOW");
  });

  test("after the change, the page is pointless and goes to the dashboard", () => {
    assert.equal(decideProxyAction(CHANGE_PASSWORD_ROUTE, true, false), "REDIRECT_TO_DASHBOARD");
  });

  test("signed out is unchanged: login first", () => {
    assert.equal(decideProxyAction(CHANGE_PASSWORD_ROUTE, false, false), "REDIRECT_TO_LOGIN");
    assert.equal(decideProxyAction("/dashboard", false, true), "REDIRECT_TO_LOGIN");
  });

  test("normal sessions are unaffected", () => {
    assert.equal(decideProxyAction("/dashboard", true, false), "ALLOW");
    assert.equal(decideProxyAction("/api/notifications", true), "ALLOW");
  });
});
