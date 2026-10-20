/**
 * Synapse usernames for employees provisioned from HR. Pure; no Prisma, no `server-only`.
 * Tested in tests/hr-lifecycle-core.test.ts.
 *
 * Rule (SIHL, 2026-10-07): "SIHL-" + the numeric employee code, zero-padded to at least 4
 * digits. Codes of 4 or more digits are used unchanged (6+ digits are NOT cut down). The
 * same prefix for all group companies — employee codes are unique across C001–C009.
 *
 * Why not email: some mailboxes are shared by a whole team (e.g. a global or marketing
 * team), so an email address does not identify one person.
 *
 * Scope:
 *   - Employees only. Partners will get their own rule, keyed on partner code.
 *   - Only users CREATED from HR. Existing users keep their usernames when linked, and a user
 *     who moves between group companies keeps their username — they are re-linked to the new
 *     HR record, not re-created.
 */

export const EMPLOYEE_USERNAME_PREFIX = "SIHL-";
export const EMPLOYEE_CODE_MIN_DIGITS = 4;

export type UsernameResult =
  | { kind: "OK"; username: string }
  /** The code does not fit the rule (non-numeric, blank). An admin decides. */
  | { kind: "INVALID"; reason: string }
  /** The username already belongs to another Synapse user. An admin decides. */
  | { kind: "TAKEN"; username: string };

/** The username an employee code maps to, ignoring what already exists. */
export function employeeUsername(code: string | null): UsernameResult {
  const c = (code ?? "").trim();
  if (c === "") return { kind: "INVALID", reason: "Employee code is blank" };
  if (!/^[0-9]+$/.test(c)) return { kind: "INVALID", reason: `Employee code ${c} is not numeric` };
  return { kind: "OK", username: EMPLOYEE_USERNAME_PREFIX + c.padStart(EMPLOYEE_CODE_MIN_DIGITS, "0") };
}

/**
 * As employeeUsername(), but checked against usernames already in use. Login matches
 * usernames case-insensitively (api/auth/login), so the check does too. Never appends a
 * suffix to dodge a clash — a clash means something is wrong and a human must look.
 */
export function planEmployeeUsername(code: string | null, taken: ReadonlySet<string>): UsernameResult {
  const r = employeeUsername(code);
  if (r.kind === "OK" && taken.has(r.username.toLowerCase())) return { kind: "TAKEN", username: r.username };
  return r;
}

/**
 * The first password for a user provisioned from HR: the username with the hyphen replaced
 * by "@" (SIHL-0123 -> SIHL@0123). It satisfies the password policy (8+ characters, upper
 * case, digit, special character, not equal to the username) and is replaced at first
 * sign-in — must_change_password is always set alongside it.
 *
 * SIHL's decision (2026-10-07), recorded with its known weakness: the password is derivable
 * from the username, so until the employee signs in for the first time, anyone who knows their
 * employee code can sign in as them and choose the new password. A random one-time password was
 * offered and declined.
 */
export function initialEmployeePassword(username: string): string {
  return username.replace("-", "@");
}
