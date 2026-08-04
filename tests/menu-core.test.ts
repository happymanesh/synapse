import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  buildMenuTree,
  findBreadcrumb,
  scopeMenusToApp,
  pickActiveApp,
  type MenuRow,
} from "../src/lib/menu-core";

/** A MenuRow with sensible defaults, so each test only states what it cares about. */
function row(over: Partial<MenuRow> & { menuCode: string }): MenuRow {
  return {
    parentMenuCode: null,
    menuName: over.menuCode,
    icon: null,
    routePath: null,
    displayOrder: 0,
    menuType: "ROUTE",
    externalUrl: null,
    reportId: null,
    ...over,
  };
}

describe("buildMenuTree", () => {
  test("nests children under their parent, three levels deep", () => {
    const tree = buildMenuTree([
      row({ menuCode: "UTIL", menuName: "Utilities" }),
      row({ menuCode: "SAMPLE", menuName: "Sample", parentMenuCode: "UTIL" }),
      row({ menuCode: "SALES", menuName: "Sales Report", parentMenuCode: "SAMPLE", routePath: "/sales" }),
    ]);

    assert.equal(tree.length, 1);
    assert.equal(tree[0].code, "UTIL");
    assert.equal(tree[0].children?.[0].code, "SAMPLE");
    assert.equal(tree[0].children?.[0].children?.[0].code, "SALES");
  });

  test("preserves the order rows arrive in (the caller sorts by displayOrder)", () => {
    const tree = buildMenuTree([
      row({ menuCode: "B", displayOrder: 1 }),
      row({ menuCode: "A", displayOrder: 2 }),
      row({ menuCode: "B2", parentMenuCode: "B", displayOrder: 1 }),
      row({ menuCode: "B1", parentMenuCode: "B", displayOrder: 2 }),
    ]);
    assert.deepEqual(tree.map((t) => t.code), ["B", "A"]);
    assert.deepEqual(tree[0].children?.map((c) => c.code), ["B2", "B1"]);
  });

  test("a child whose parent was not granted is promoted to a root, never dropped", () => {
    // The access chain filters rows by role, so a granted child can arrive without
    // its parent. Dropping it would silently revoke access the admin did grant.
    const tree = buildMenuTree([row({ menuCode: "ORPHAN", parentMenuCode: "NOT_GRANTED", routePath: "/orphan" })]);
    assert.equal(tree.length, 1);
    assert.equal(tree[0].code, "ORPHAN");
  });

  test("REPORT items route to /reports/{reportId}, overriding any stored routePath", () => {
    const tree = buildMenuTree([
      row({ menuCode: "R", menuType: "REPORT", reportId: "SALES_REPORT", routePath: "/ignored" }),
    ]);
    assert.equal(tree[0].routePath, "/reports/SALES_REPORT");
  });

  test("a REPORT item with no reportId falls back to its routePath rather than /reports/null", () => {
    const tree = buildMenuTree([row({ menuCode: "R", menuType: "REPORT", reportId: null, routePath: "/fallback" })]);
    assert.equal(tree[0].routePath, "/fallback");
  });

  test("EXTERNAL items keep their externalUrl", () => {
    const tree = buildMenuTree([row({ menuCode: "X", menuType: "EXTERNAL", externalUrl: "https://example.com" })]);
    assert.equal(tree[0].externalUrl, "https://example.com");
    assert.equal(tree[0].menuType, "EXTERNAL");
  });

  test("nulls become undefined, not the string 'null'", () => {
    const tree = buildMenuTree([row({ menuCode: "M" })]);
    assert.equal(tree[0].icon, undefined);
    assert.equal(tree[0].routePath, undefined);
    assert.equal(tree[0].externalUrl, undefined);
  });

  test("no rows means no tree", () => {
    assert.deepEqual(buildMenuTree([]), []);
  });
});

describe("findBreadcrumb", () => {
  const tree = buildMenuTree([
    row({ menuCode: "UTIL", menuName: "Utilities" }),
    row({ menuCode: "SAMPLE", menuName: "Sample", parentMenuCode: "UTIL" }),
    row({ menuCode: "SALES", menuName: "Sales Report", parentMenuCode: "SAMPLE", menuType: "REPORT", reportId: "SALES_REPORT" }),
    row({ menuCode: "ADMIN", menuName: "Administration", routePath: "/admin" }),
  ]);

  test("returns the full chain of names down to the match", () => {
    assert.deepEqual(findBreadcrumb(tree, "/reports/SALES_REPORT"), ["Utilities", "Sample", "Sales Report"]);
  });

  test("a top-level match is a single-element trail", () => {
    assert.deepEqual(findBreadcrumb(tree, "/admin"), ["Administration"]);
  });

  test("an unknown route returns null rather than a partial trail", () => {
    assert.equal(findBreadcrumb(tree, "/nowhere"), null);
  });

  test("a parent with no routePath of its own is not matched by an empty path", () => {
    assert.equal(findBreadcrumb(tree, ""), null);
  });
});

describe("scopeMenusToApp", () => {
  const menus = [
    { menuCode: "BROK_DASH", appCode: "BROKING" },
    { menuCode: "MF_DASH", appCode: "MUTUALFUND" },
    { menuCode: "ADMIN", appCode: null },
  ];

  test("keeps the active app's menus plus the global ones", () => {
    assert.deepEqual(
      scopeMenusToApp(menus, "BROKING").map((m) => m.menuCode),
      ["BROK_DASH", "ADMIN"]
    );
  });

  test("excludes every other app's menus", () => {
    assert.equal(scopeMenusToApp(menus, "BROKING").some((m) => m.menuCode === "MF_DASH"), false);
  });

  test("global menus survive an app switch — Administration must never become unreachable", () => {
    for (const app of ["BROKING", "MUTUALFUND"]) {
      assert.ok(
        scopeMenusToApp(menus, app).some((m) => m.menuCode === "ADMIN"),
        `ADMIN missing under ${app}`
      );
    }
  });

  test("no active app filters nothing out", () => {
    assert.equal(scopeMenusToApp(menus, null).length, 3);
  });

  test("an app the user has no menus for yields only the global menus", () => {
    assert.deepEqual(
      scopeMenusToApp(menus, "UNKNOWN_APP").map((m) => m.menuCode),
      ["ADMIN"]
    );
  });
});

describe("pickActiveApp", () => {
  const apps = [{ code: "BROKING" }, { code: "MUTUALFUND" }];

  test("prefers the last app used", () => {
    assert.equal(pickActiveApp(apps, "MUTUALFUND")?.code, "MUTUALFUND");
  });

  test("falls back to the first app when the last one is no longer accessible", () => {
    // The app could have been deactivated, or the role granting it revoked, since
    // the user last opened it — they must not be left on a dead app.
    assert.equal(pickActiveApp(apps, "REVOKED_APP")?.code, "BROKING");
  });

  test("falls back to the first app when nothing was ever opened", () => {
    assert.equal(pickActiveApp(apps, null)?.code, "BROKING");
  });

  test("a user with no apps has no active app", () => {
    assert.equal(pickActiveApp([], "BROKING"), null);
    assert.equal(pickActiveApp([], null), null);
  });
});
