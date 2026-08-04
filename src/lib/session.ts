import "server-only";
import { cache } from "react";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";

export interface SessionPayload {
  userUid: number;
  username: string;
  fullName: string;
  companyCode: string;
  hierarchyCode: string;
  hierarchyName: string;
  roles: string[];
  [key: string]: unknown;
}

const SESSION_COOKIE = "synapse_session";
const SESSION_DURATION_MS = 8 * 60 * 60 * 1000; // 8 hours

const secretKey = process.env.SESSION_SECRET;
if (!secretKey) {
  throw new Error("SESSION_SECRET environment variable is not set.");
}
const encodedKey = new TextEncoder().encode(secretKey);

async function encrypt(payload: SessionPayload): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("8h")
    .sign(encodedKey);
}

async function decrypt(session: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(session, encodedKey, { algorithms: ["HS256"] });
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
    select: { isActive: true },
  });
  return user?.isActive === true;
});

export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const session = cookieStore.get(SESSION_COOKIE)?.value;
  if (!session) return null;
  const payload = await decrypt(session);
  if (!payload) return null;
  // The token stays cryptographically valid for its full 8 hours, so deactivating
  // someone in User Master would otherwise leave them working until it expired.
  // The check belongs here — the one path every route reads the session through —
  // rather than at each call site, where it would eventually be forgotten.
  if (!(await isUserActive(payload.userUid))) return null;
  return payload;
}

export async function deleteSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}
