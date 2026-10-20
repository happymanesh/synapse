import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { createSession, getSession } from "@/lib/session";
import { isPasswordReused, validatePasswordChangeRequest } from "@/lib/password-policy";

/**
 * Self-service password change for the signed-in user.
 *
 * Distinct from `/api/admin/users/[id]/reset-password`, which lets an administrator set
 * someone else's password without knowing the old one. Here the current password is
 * mandatory: a session cookie alone must not be enough to change it, or anyone who picked
 * up an unlocked machine could lock the owner out of their own account.
 *
 * The password rules themselves are the admin route's, unchanged — same length, character
 * and last-3 history checks — so a password set here and a password set for you are held to
 * one standard.
 */
export async function POST(request: NextRequest) {
  // The one route (with the change-password page) open to a first-login session.
  const session = await getSession({ allowPendingPasswordChange: true });
  if (!session) {
    // JSON, not a redirect: this is called by fetch(). See the UNAUTHORIZED_JSON reasoning
    // in @/lib/auth-core.
    return NextResponse.json({ error: "Your session has expired. Please sign in again." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const check = validatePasswordChangeRequest(body, session.username);
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: 400 });
  }

  const user = await prisma.userDetails.findUnique({ where: { uid: session.userUid } });
  if (!user) {
    return NextResponse.json({ error: "Your session has expired. Please sign in again." }, { status: 401 });
  }

  const currentMatches = await bcrypt.compare(check.currentPassword, user.passwordHash);
  if (!currentMatches) {
    // Deliberately says which field is wrong. The generic "invalid username or password" of
    // the login route protects against username enumeration; there is nothing to enumerate
    // here, and an unhelpful message would just make people retype the new password too.
    //
    // Not logged to login_logs: those rows are the record of sign-in attempts, and mixing a
    // different event into them would quietly corrupt the login analytics they exist for.
    return NextResponse.json({ error: "Your current password is not correct." }, { status: 400 });
  }

  const history = await prisma.passwordHistory.findMany({
    where: { userUid: session.userUid },
    orderBy: { changedDate: "desc" },
    take: 3,
  });
  // The live hash is included alongside the history because an account that has never
  // changed its password has no history row at all — a seeded user could otherwise "change"
  // it to what it already is.
  const reused = await isPasswordReused(check.newPassword, [
    user.passwordHash,
    ...history.map((h) => h.passwordHash),
  ]);
  if (reused) {
    return NextResponse.json(
      { error: "Password must not match any of the last 3 passwords used." },
      { status: 400 }
    );
  }

  const passwordHash = await bcrypt.hash(check.newPassword, 10);
  await prisma.$transaction([
    prisma.userDetails.update({
      where: { uid: session.userUid },
      data: { passwordHash, lastPasswordChangedDate: new Date(), mustChangePassword: false },
    }),
    prisma.passwordHistory.create({ data: { userUid: session.userUid, passwordHash } }),
  ]);

  // A first-login session carries the mustChangePassword claim that keeps it on the
  // change-password page; re-issue it without the claim so the user can carry on.
  if (session.mustChangePassword) {
    const { mustChangePassword: _done, iat: _iat, exp: _exp, ...rest } = session;
    void _done; void _iat; void _exp;
    await createSession(rest as typeof session);
  }

  // The session cookie is a signed JWT carrying no password material, so it stays valid and
  // the user is not thrown out mid-task. Worth knowing: sessions are stateless, so a change
  // made because a password was exposed does NOT end a session already open elsewhere —
  // closing those needs a session store, which this phase does not have.
  return NextResponse.json({ success: true });
}
