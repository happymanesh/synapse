import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  validateMailConfig,
  describeMailConfigProblems,
  type MailConfigLike,
} from "../src/lib/mail/mail-config-core";

const GOOD: MailConfigLike = {
  driver: "sendgrid",
  apiKey: "SG.abcdefghijklmnopqrstuvwxyz",
  from: "no-reply@sihl.in",
  appUrl: "https://synapse.sihl.in",
};

describe("validateMailConfig — the noop case", () => {
  test("says nothing when the driver is noop, whatever else is missing", () => {
    // An unset MAIL_DRIVER is a supported state: development, CI, and any environment that
    // genuinely does not send. Complaining would give every developer a startup error for a
    // feature they are not using.
    assert.deepEqual(
      validateMailConfig({ driver: "noop", apiKey: undefined, from: undefined, appUrl: "http://localhost:3010" }),
      []
    );
  });
});

describe("validateMailConfig — a complete configuration", () => {
  test("accepts a fully configured sender", () => {
    assert.deepEqual(validateMailConfig(GOOD), []);
  });

  test("accepts any non-localhost app URL", () => {
    assert.deepEqual(validateMailConfig({ ...GOOD, appUrl: "https://synapse-uat.sihl.in" }), []);
  });
});

describe("validateMailConfig — the failure that prompted this", () => {
  test("catches MAIL_DRIVER=sendgrid with nothing else set", () => {
    // Exactly the deployment that produced silent [FAILED] rows nobody looked at.
    const problems = validateMailConfig({
      driver: "sendgrid",
      apiKey: undefined,
      from: undefined,
      appUrl: "http://localhost:3010",
    });
    assert.equal(problems.length, 3);
    assert.ok(problems.some((p) => p.includes("SENDGRID_API_KEY is missing")));
    assert.ok(problems.some((p) => p.includes("MAIL_FROM is missing")));
    assert.ok(problems.some((p) => p.includes("MAIL_APP_URL")));
  });
});

describe("validateMailConfig — individual rules", () => {
  test("a missing key is reported", () => {
    assert.ok(validateMailConfig({ ...GOOD, apiKey: "" }).some((p) => p.includes("missing")));
  });

  test("a key that is not a SendGrid key is reported", () => {
    // Catches a pasted placeholder or a truncated value, the realistic mistake.
    assert.ok(
      validateMailConfig({ ...GOOD, apiKey: "your-api-key-here" }).some((p) => p.includes("does not look like"))
    );
  });

  test("a missing sender is reported, and says it must be verified", () => {
    const problems = validateMailConfig({ ...GOOD, from: undefined });
    assert.ok(problems.some((p) => p.includes("verified as a sender")));
  });

  test("a sender that is not an address is reported", () => {
    for (const from of ["SIHL Synapse", "no-reply@", "@sihl.in", "no-reply.sihl.in"]) {
      assert.ok(validateMailConfig({ ...GOOD, from }).some((p) => p.includes("not an email address")), from);
    }
  });

  test("a localhost app URL is reported, because every link would be unreachable", () => {
    for (const appUrl of ["http://localhost:3010", "https://localhost:3010", "http://127.0.0.1:3010"]) {
      assert.ok(validateMailConfig({ ...GOOD, appUrl }).some((p) => p.includes("unreachable")), appUrl);
    }
  });

  test("a host merely containing 'localhost' is not flagged", () => {
    // localhost.sihl.in is a real hostname; the check is on the host, not the substring.
    assert.deepEqual(validateMailConfig({ ...GOOD, appUrl: "https://localhost.sihl.in" }), []);
  });
});

describe("describeMailConfigProblems", () => {
  test("is null when there is nothing to say", () => {
    assert.equal(describeMailConfigProblems([]), null);
  });

  test("lists every problem and says how to resolve it either way", () => {
    const message = describeMailConfigProblems(validateMailConfig({ ...GOOD, apiKey: undefined }))!;
    assert.ok(message.includes("SENDGRID_API_KEY is missing"));
    assert.ok(message.includes("unset MAIL_DRIVER"));
    // The point of the whole exercise: name the symptom it replaces.
    assert.ok(message.includes("channel_message"));
  });
});
