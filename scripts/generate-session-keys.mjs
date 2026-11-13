/**
 * Generates the RS256 keypair Synapse signs sessions with.
 *
 *   node scripts/generate-session-keys.mjs
 *
 * Prints two values, base64-encoded so they fit a single-line environment variable:
 *
 *   SESSION_PRIVATE_KEY  Synapse only. Never leaves this application.
 *   SESSION_PUBLIC_KEY   Safe to share with any integrated app, and with no one's help
 *                        needed to do it securely — it is not a secret.
 *
 * Generate a SEPARATE keypair per environment. A UAT key that also opens production is
 * not a second environment, it is the same one with two URLs.
 */
import { generateKeyPairSync } from "node:crypto";

const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

const b64 = (pem) => Buffer.from(pem, "utf8").toString("base64");

console.log("SESSION_PRIVATE_KEY=" + b64(privateKey));
console.log();
console.log("SESSION_PUBLIC_KEY=" + b64(publicKey));
console.log();
console.log("# Set both on Synapse. Give integrated apps the PUBLIC key only.");
console.log("# Changing these signs everyone out once — plan it like a password rotation.");
