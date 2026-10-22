/**
 * What the audit trail records, and what it must never record.
 *
 * Pure and Prisma-free so it is unit tested (tests/audit-core.test.ts). The interception
 * itself is a Prisma client extension in src/lib/audit.ts — there are 34 admin route files
 * performing writes and the 35th would forget to call a helper, so this hooks the one path
 * every write already goes through rather than each call site.
 */

export type AuditAction = "CREATE" | "UPDATE" | "DELETE";

export const SYSTEM_ACTOR = "SYSTEM";

/**
 * Never written to the audit log, at any nesting depth.
 *
 * An audit trail is read by more people than the table it describes — support staff,
 * auditors, anyone granted the screen — so copying a password hash into it widens exposure
 * of the most sensitive column in the database. Matched on the field name rather than a
 * list of models, so a hash on a new model is covered the day it is added.
 */
const REDACTED_FIELD = /password|secret|token|apikey|api_key|privatekey|private_key|salt/i;

export const REDACTED = "[redacted]";

/** Models whose writes are not audited. */
const SKIPPED_MODELS = new Set([
  // Would recurse: auditing the audit write.
  "AuditLog",
  // High-volume machine chatter, already append-only logs in their own right. Auditing
  // them would bury the handful of administrative changes anyone actually needs to find.
  "LoginLog",
  "MenuUsageLog",
  "NotificationRead",
  "HrRawEmployee",
  "HrEmployeeChange",
  "HrIngestRun",
  "PasswordHistory",
]);

export function isAuditedModel(model: string | undefined): boolean {
  return !!model && !SKIPPED_MODELS.has(model);
}

/** Replaces sensitive values, recursing into nested objects and arrays. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = REDACTED_FIELD.test(k) ? REDACTED : redact(v, depth + 1);
  }
  return out;
}

export interface FieldChange {
  from: unknown;
  to: unknown;
}

/**
 * Only the fields that actually changed.
 *
 * An update that writes a whole form back unchanged would otherwise record forty identical
 * before/after pairs, and the one field that moved would be impossible to see. Returns an
 * empty object when nothing changed, which the caller treats as nothing worth recording.
 */
export function diffRecords(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null
): Record<string, FieldChange> {
  if (!before || !after) return {};
  const changes: Record<string, FieldChange> = {};
  for (const key of Object.keys(after)) {
    const a = normalise(before[key]);
    const b = normalise(after[key]);
    if (a !== b) {
      changes[key] = {
        from: REDACTED_FIELD.test(key) ? REDACTED : (redact(before[key]) ?? null),
        to: REDACTED_FIELD.test(key) ? REDACTED : (redact(after[key]) ?? null),
      };
    }
  }
  return changes;
}

/** Comparable form, so a Date and its stored value don't read as a change on every save. */
function normalise(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/**
 * The record's identity, as a string.
 *
 * Models here key on a code (companyCode, menuCode) as often as on a numeric id, and a
 * couple are composite, so this tries the known shapes rather than assuming `id`.
 */
export function recordIdOf(row: Record<string, unknown> | null | undefined): string | null {
  if (!row) return null;
  for (const key of ["id", "uid", "companyCode", "menuCode", "roleCode", "appCode", "reportId", "filterId", "componentCode", "hierarchyCode", "clientCategoryCode", "username"]) {
    const v = row[key];
    if (v !== undefined && v !== null) return String(v);
  }
  return null;
}
