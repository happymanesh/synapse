import { importPKCS8, importSPKI, type CryptoKey } from "jose";

/**
 * The keys Synapse signs and verifies sessions with.
 *
 * Deliberately **not** `server-only`: `src/proxy.ts` imports this and runs in Next's Edge
 * runtime. Everything here is therefore Web Crypto and `atob`, never `node:crypto`,
 * `Buffer` or `fs` — all of which are unavailable there.
 *
 * RS256, not HS256. The two algorithms differ in one way that matters: HS256 is symmetric,
 * so the key that verifies a token also signs one. Any application given it to check a
 * session can equally mint a session for any user. With RS256, Synapse keeps the private
 * key and every integrated app holds only the public key — which is not a secret, can be
 * emailed or committed, and allows verification and nothing else.
 */

export const SESSION_JWT_ALG = "RS256";

/**
 * Accepts either a raw PEM or a base64-encoded one.
 *
 * Base64 is the practical form: a PEM is multi-line, and multi-line values are awkward in
 * most hosts' environment-variable editors — Railway's included. Raw PEM stays supported so
 * a local `.env` can hold whichever is to hand.
 */
function decodePem(value: string, name: string): string {
  const trimmed = value.trim();
  if (trimmed.includes("-----BEGIN")) return trimmed;
  try {
    // atob, not Buffer: this runs in the Edge runtime too.
    return atob(trimmed);
  } catch {
    throw new Error(`${name} is neither a PEM nor valid base64.`);
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    // Fail at startup rather than on the first sign-in. A missing key means no session can
    // ever be issued or checked, and that should be loud rather than a 500 per request.
    throw new Error(
      `${name} is not set. Generate a keypair with \`node scripts/generate-session-keys.mjs\` ` +
        `and see docs/05-uat-deployment.md.`
    );
  }
  return value;
}

// Imports are async and the result is reusable, so each is cached as a promise rather than
// re-imported per request — key import is the expensive part of RS256 verification.
let privateKeyPromise: Promise<CryptoKey> | null = null;
let publicKeyPromise: Promise<CryptoKey> | null = null;

/** Signing key. Synapse only — never leaves this application. */
export function getSessionPrivateKey(): Promise<CryptoKey> {
  privateKeyPromise ??= importPKCS8(
    decodePem(requireEnv("SESSION_PRIVATE_KEY"), "SESSION_PRIVATE_KEY"),
    SESSION_JWT_ALG
  );
  return privateKeyPromise;
}

/** Verification key. Safe to share with any integrated application. */
export function getSessionPublicKey(): Promise<CryptoKey> {
  publicKeyPromise ??= importSPKI(
    decodePem(requireEnv("SESSION_PUBLIC_KEY"), "SESSION_PUBLIC_KEY"),
    SESSION_JWT_ALG
  );
  return publicKeyPromise;
}
