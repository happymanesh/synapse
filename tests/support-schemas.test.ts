import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  issueCategorySchema,
  issueCategoryUpdateSchema,
  NEW_MODULE_SENTINEL,
} from "../src/lib/support-schemas";

/** A valid submission, so each test states only what it varies. */
function body(over: Record<string, unknown> = {}) {
  return {
    categoryCode: "EQ-BUG",
    categoryName: "Equities — Bug",
    productModule: "Equities",
    issueType: "BUG",
    description: "",
    displayOrder: 10,
    isActive: true,
    ...over,
  };
}

/** The first message for a given field, or null. */
function fieldError(result: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }, field: string) {
  if (result.success) return null;
  return result.error!.issues.find((i) => i.path[0] === field)?.message ?? null;
}

describe("issueCategorySchema", () => {
  test("accepts a straightforward category and passes the module through", () => {
    const parsed = issueCategorySchema.parse(body());
    assert.equal(parsed.productModule, "Equities");
    assert.equal(parsed.categoryCode, "EQ-BUG");
    assert.equal(parsed.issueType, "BUG");
  });

  test("an empty description becomes null, not an empty string", () => {
    assert.equal(issueCategorySchema.parse(body()).description, null);
  });

  test("displayOrder arrives from a form as a string and is coerced", () => {
    assert.equal(issueCategorySchema.parse(body({ displayOrder: "30" })).displayOrder, 30);
  });

  test("names and codes are trimmed", () => {
    const parsed = issueCategorySchema.parse(body({ categoryCode: "  EQ-BUG  ", categoryName: "  Bug  " }));
    assert.equal(parsed.categoryCode, "EQ-BUG");
    assert.equal(parsed.categoryName, "Bug");
  });
});

describe("category code shape", () => {
  test("rejects lower case, so EQ-BUG and eq-bug cannot become two categories", () => {
    assert.ok(fieldError(issueCategorySchema.safeParse(body({ categoryCode: "eq-bug" })), "categoryCode"));
  });

  test("rejects spaces and punctuation that would read badly as an identifier", () => {
    for (const code of ["EQ BUG", "EQ.BUG", "EQ/BUG"]) {
      assert.ok(fieldError(issueCategorySchema.safeParse(body({ categoryCode: code })), "categoryCode"), code);
    }
  });

  test("allows capitals, digits, hyphen and underscore", () => {
    for (const code of ["EQ-BUG", "BO_SERVICE_REQUEST", "RMS2"]) {
      assert.equal(issueCategorySchema.safeParse(body({ categoryCode: code })).success, true, code);
    }
  });

  test("a blank code is rejected", () => {
    assert.ok(fieldError(issueCategorySchema.safeParse(body({ categoryCode: "   " })), "categoryCode"));
  });
});

describe("issueType", () => {
  test("accepts the four defined types", () => {
    for (const t of ["QUERY", "COMPLAINT", "BUG", "SERVICE_REQUEST"]) {
      assert.equal(issueCategorySchema.safeParse(body({ issueType: t })).success, true, t);
    }
  });

  test("rejects anything else — it is a reporting dimension, not free text", () => {
    for (const t of ["Bug", "bug", "INCIDENT", ""]) {
      assert.equal(issueCategorySchema.safeParse(body({ issueType: t })).success, false, JSON.stringify(t));
    }
  });
});

describe("new-module escape hatch", () => {
  test("the sentinel resolves to the typed name, so the column never stores '__NEW__'", () => {
    const parsed = issueCategorySchema.parse(
      body({ productModule: NEW_MODULE_SENTINEL, productModuleNew: "Currency Derivatives" })
    );
    assert.equal(parsed.productModule, "Currency Derivatives");
  });

  test("the resolved name is trimmed", () => {
    const parsed = issueCategorySchema.parse(
      body({ productModule: NEW_MODULE_SENTINEL, productModuleNew: "  Commodities  " })
    );
    assert.equal(parsed.productModule, "Commodities");
  });

  test("choosing 'new' without typing a name is an error on the name field", () => {
    // Must point at productModuleNew so the form highlights the box the user has to fill,
    // not the dropdown they already answered correctly.
    const result = issueCategorySchema.safeParse(body({ productModule: NEW_MODULE_SENTINEL, productModuleNew: "" }));
    assert.equal(result.success, false);
    assert.ok(fieldError(result, "productModuleNew"));
  });

  test("whitespace alone does not count as a new module name", () => {
    const result = issueCategorySchema.safeParse(body({ productModule: NEW_MODULE_SENTINEL, productModuleNew: "   " }));
    assert.equal(result.success, false);
  });

  test("a stray new-module name is ignored when an existing module was chosen", () => {
    const parsed = issueCategorySchema.parse(body({ productModule: "Equities", productModuleNew: "Ignored" }));
    assert.equal(parsed.productModule, "Equities");
  });

  test("productModuleNew never survives into the payload written to the database", () => {
    const parsed = issueCategorySchema.parse(
      body({ productModule: NEW_MODULE_SENTINEL, productModuleNew: "Commodities" })
    );
    assert.equal("productModuleNew" in parsed, false);
  });
});

describe("issueCategoryUpdateSchema", () => {
  test("does not carry categoryCode — the code is the identity and is not editable", () => {
    const { categoryCode: _drop, ...rest } = body();
    const parsed = issueCategoryUpdateSchema.parse(rest);
    assert.equal("categoryCode" in parsed, false);
  });

  test("applies the same new-module resolution as create", () => {
    const { categoryCode: _drop, ...rest } = body({
      productModule: NEW_MODULE_SENTINEL,
      productModuleNew: "Mutual Funds",
    });
    assert.equal(issueCategoryUpdateSchema.parse(rest).productModule, "Mutual Funds");
  });
});
