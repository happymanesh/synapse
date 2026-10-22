/**
 * Lockout policy for repeated failed sign-ins.
 *
 * Synapse usernames are employee codes (SIHL-0720), so they are not secret, and until a
 * user changes it their first password is derivable from the username
 * (src/lib/hr/lifecycle/username-core.ts, SIHL's decision of 2026-10-07). Unlimited guesses
 * against a known username is therefore the weakest point in the sign-in path. The data to
 * stop it was already being written — every attempt lands in login_log with a
 * failureReason — but nothing read it.
 *
 * Pure and Prisma-free so it can be unit tested (tests/login-throttle-core.test.ts); the
 * counting queries live in the login route.
 */

/** Failures against one username before it is locked. */
export const MAX_FAILURES_PER_USERNAME = 5;

/**
 * Failures from one IP across *any* username, which catches the attacker who rotates
 * usernames to stay under the per-username limit. Higher, because a shared office NAT
 * puts a whole branch behind one address and a few genuine typos must not lock them all.
 */
export const MAX_FAILURES_PER_IP = 20;

/** How far back failures are counted, and how long a lockout therefore lasts. */
export const LOCKOUT_WINDOW_MINUTES = 15;

export const LOCKOUT_WINDOW_MS = LOCKOUT_WINDOW_MINUTES * 60 * 1000;

/** The oldest attempt still counted. */
export function windowStart(now: Date): Date {
  return new Date(now.getTime() - LOCKOUT_WINDOW_MS);
}

/**
 * Failures are only counted since the user's last *successful* sign-in — a success proves
 * the account holder is present, so it clears the slate rather than leaving someone locked
 * out by old noise. A success older than the window is irrelevant; the window still bounds it.
 */
export function countFrom(now: Date, lastSuccessAt: Date | null): Date {
  const start = windowStart(now);
  return lastSuccessAt && lastSuccessAt > start ? lastSuccessAt : start;
}

export type LockoutReason = "USERNAME" | "IP";

/** Which limit, if any, this attempt has hit. Username is checked first so the message is specific. */
export function lockoutReason(usernameFailures: number, ipFailures: number): LockoutReason | null {
  if (usernameFailures >= MAX_FAILURES_PER_USERNAME) return "USERNAME";
  if (ipFailures >= MAX_FAILURES_PER_IP) return "IP";
  return null;
}

/**
 * Deliberately says the account is temporarily locked rather than whether the username
 * exists: the generic "Invalid username or password" elsewhere in this route exists to avoid
 * confirming which usernames are real, and a lockout message must not undo that.
 */
export function lockoutMessage(reason: LockoutReason): string {
  return reason === "USERNAME"
    ? `Too many failed sign-in attempts. Try again in ${LOCKOUT_WINDOW_MINUTES} minutes, or contact your administrator.`
    : `Too many failed sign-in attempts from this network. Try again in ${LOCKOUT_WINDOW_MINUTES} minutes.`;
}
