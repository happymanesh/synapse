import "server-only";
import { cache } from "react";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { getSessionPrivateKey, getSessionPublicKey, SESSION_JWT_ALG } from "@/lib/session-keys";
import { prisma } from "@/lib/db";
import { accountBlock } from "@/lib/auth-core";

export interface SessionPayload {
  userUid: number;
  username: string;
  fullName: string;
  companyCode: string;
  hierarchyCode: string;
  hierarchyName: string;
  roles: string[];
  /** Set at sign-in for a must_change_password user; cleared when they change it. */
  mustChangePassword?: boolean;
  [key: string]: unknown;
}

const SESSION_COOKIE = "synapse_session";
const SESSION_DURATION_MS = 8 * 60 * 60 * 1000; // 8 hours

async function encrypt(payload: SessionPayload): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: SESSION_JWT_ALG })
    .setIssuedAt()
    .setExpirationTime("8h")
    .sign(await getSessionPrivateKey());
}

async function decrypt(session: string): Promise<SessionPayload | null> {
  try {
    // Verified with the PUBLIC key, and `algorithms` is pinned: without that pin a token
    // could declare `alg: none`, or an HS256 token could be verified against the public
    // key treated as a shared secret — both classic JWT confusion attacks.
    const { payload } = await jwtVerify(session, await getSessionPublicKey(), {
      algorithms: [SESSION_JWT_ALG],
    });
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

export async function createSession(payload: SessionPayload): Promise<void> {
  const session = await encrypt(payload);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, session, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    expires: new Date(Date.now() + SESSION_DURATION_MS),
    sameSite: "lax",
    path: "/",
  });
}

/**
 * Memoised per request: getSession() is read by the layout, the sidebar and every
 * API route in a single render, and they must not each cost a round trip.
 */
const isUserActive = cache(async (userUid: number): Promise<boolean> => {
  const user = await prisma.userDetails.findUnique({
    where: { uid: userUid },
    select: { isActive: true, isSuspended: true },
  });
  return !!user && accountBlock(user) === null;
});

/**
 * `allowPendingPasswordChange` is for the change-password page and API only. Everywhere
 * else a session still waiting for its first-login password change counts as no session —
 * the proxy already keeps such users on the change-password page; this is the second lock.
 */
export async function getSession(opts: { allowPendingPasswordChange?: boolean } = {}): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const session = cookieStore.get(SESSION_COOKIE)?.value;
  if (!session) return null;
  const payload = await decrypt(session);
  if (!payload) return null;
  // The token stays cryptographically valid for its full 8 hours, so deactivating or
  // suspending someone would otherwise leave them working until it expired.
  // The check belongs here — the one path every route reads the session through —
  // rather than at each call site, where it would eventually be forgotten.
  if (!(await isUserActive(payload.userUid))) return null;
  if (payload.mustChangePassword && !opts.allowPendingPasswordChange) return null;
  return payload;
}

export async function deleteSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}
