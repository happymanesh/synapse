import bcrypt from "bcryptjs";

export interface PasswordPolicyResult {
  valid: boolean;
  errors: string[];
}

const SPECIAL_CHARS = /[!@#$%^&*]/;

/**
 * bcrypt hashes at most 72 bytes and silently ignores the rest — so without this cap a
 * 90-character passphrase would later "work" when only its first 72 bytes were typed, and
 * the owner would never know their password was shorter than they believe. Rejecting is
 * kinder than truncating. Bytes, not characters: a Devanagari or Tamil password reaches 72
 * bytes in roughly 24 characters.
 */
export const MAX_PASSWORD_BYTES = 72;

export function checkPasswordPolicy(password: string, username: string): PasswordPolicyResult {
  const errors: string[] = [];

  if (password.length < 8) {
    errors.push("Password must be at least 8 characters long.");
  }
  if (new TextEncoder().encode(password).length > MAX_PASSWORD_BYTES) {
    errors.push(
      "Password is too long. Use 72 characters or fewer — fewer still if it contains non-English characters."
    );
  }
  if (!/[A-Z]/.test(password)) {
    errors.push("Password must contain at least one uppercase letter.");
  }
  if (!/[0-9]/.test(password)) {
    errors.push("Password must contain at least one number.");
  }
  if (!SPECIAL_CHARS.test(password)) {
    errors.push("Password must contain at least one special character (!@#$%^&*).");
  }
  if (password.toLowerCase() === username.toLowerCase()) {
    errors.push("Password must not be the same as the username.");
  }

  return { valid: errors.length === 0, errors };
}

export async function isPasswordReused(password: string, previousHashes: string[]): Promise<boolean> {
  for (const hash of previousHashes) {
    if (await bcrypt.compare(password, hash)) {
      return true;
    }
  }
  return false;
}

export type PasswordChangeCheck =
  | { ok: true; currentPassword: string; newPassword: string }
  | { ok: false; error: string };

/**
 * Everything about a self-service password change that can be decided without the database.
 *
 * Kept pure (no Prisma, no `server-only`) so the rules are unit tested directly rather than
 * only through an authenticated HTTP route — see tests/password-policy.test.ts.
 *
 * Runs before the expensive checks on purpose: a mistyped confirmation should not cost two
 * bcrypt comparisons, and the caller should not read the user row to find out the request
 * was malformed.
 *
 * One error at a time, in the order a person would fix them. Returning "passwords do not
 * match" together with a policy complaint about a password they are about to retype reads
 * as two problems when there is one.
 */
export function validatePasswordChangeRequest(body: unknown, username: string): PasswordChangeCheck {
  const field = (name: string): string => {
    const value = (body as Record<string, unknown> | null)?.[name];
    return typeof value === "string" ? value : "";
  };

  const currentPassword = field("currentPassword");
  const newPassword = field("newPassword");
  const confirmPassword = field("confirmPassword");

  if (!currentPassword || !newPassword || !confirmPassword) {
    return { ok: false, error: "Enter your current password, the new password, and the confirmation." };
  }
  if (newPassword !== confirmPassword) {
    return { ok: false, error: "The new password and its confirmation do not match." };
  }
  // Checked here against what the user typed, not against the stored hash: the caller
  // verifies the current password separately, so by the time it accepts this request the
  // two facts together rule out a no-op change.
  if (newPassword === currentPassword) {
    return { ok: false, error: "The new password must be different from your current password." };
  }

  const policy = checkPasswordPolicy(newPassword, username);
  if (!policy.valid) {
    return { ok: false, error: policy.errors.join(" ") };
  }

  return { ok: true, currentPassword, newPassword };
}
