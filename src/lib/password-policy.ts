import bcrypt from "bcryptjs";

export interface PasswordPolicyResult {
  valid: boolean;
  errors: string[];
}

const SPECIAL_CHARS = /[!@#$%^&*]/;

export function checkPasswordPolicy(password: string, username: string): PasswordPolicyResult {
  const errors: string[] = [];

  if (password.length < 8) {
    errors.push("Password must be at least 8 characters long.");
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
