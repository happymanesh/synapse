/**
 * Column formatting/sorting rule (see CLAUDE.md "Date/number column formatting"):
 * dates render dd-Mmm-yy, datetimes render dd-Mmm-yy hh:mm, and sorting on either
 * always compares the underlying Date value — never the formatted text.
 * Every report table in this app must go through these helpers rather than
 * reinventing date formatting/sorting per report.
 *
 * Seconds are deliberately NOT part of the default datetime. They are noise on a
 * business date, and only earn their place where events can land inside the same
 * minute and their ORDER matters — an audit trail, or the timestamps behind a merge.
 * Use formatDateTimeSeconds() there, and only there.
 */

export type ColumnDataType = "TEXT" | "NUMBER" | "DATE" | "DATETIME";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function toDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export function formatDate(value: unknown): string {
  const d = toDate(value);
  if (!d) return "—";
  // Two-digit year: these are business dates read in bulk down a column, where the
  // century is never in question and the extra glyphs only cost width.
  return `${pad2(d.getDate())}-${MONTHS[d.getMonth()]}-${String(d.getFullYear()).slice(-2)}`;
}

export function formatDateTime(value: unknown): string {
  const d = toDate(value);
  if (!d) return "—";
  return `${formatDate(value)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** dd-Mmm-yy hh:mm:ss — for timestamps whose ordering within a minute matters. */
export function formatDateTimeSeconds(value: unknown): string {
  const d = toDate(value);
  if (!d) return "—";
  return `${formatDateTime(value)}:${pad2(d.getSeconds())}`;
}

export function formatNumber(value: unknown, decimalPlaces?: number | null): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(n)) return String(value);
  if (decimalPlaces !== undefined && decimalPlaces !== null) {
    return n.toFixed(decimalPlaces);
  }
  return String(n);
}

export function formatCellByType(value: unknown, dataType: ColumnDataType, decimalPlaces?: number | null): string {
  switch (dataType) {
    case "DATE":
      return formatDate(value);
    case "DATETIME":
      return formatDateTime(value);
    case "NUMBER":
      return formatNumber(value, decimalPlaces);
    default:
      if (value === null || value === undefined || value === "") return "—";
      if (typeof value === "boolean") return value ? "Yes" : "No";
      return String(value);
  }
}

export function alignmentForType(dataType: ColumnDataType): "left" | "center" | "right" {
  if (dataType === "DATE" || dataType === "DATETIME") return "center";
  if (dataType === "NUMBER") return "right";
  return "left";
}

/** Always compares the underlying value for DATE/DATETIME/NUMBER — never the formatted display text. */
export function compareByType(a: unknown, b: unknown, dataType: ColumnDataType): number {
  if (dataType === "DATE" || dataType === "DATETIME") {
    const da = toDate(a)?.getTime();
    const db = toDate(b)?.getTime();
    if (da === undefined && db === undefined) return 0;
    if (da === undefined) return -1;
    if (db === undefined) return 1;
    return da - db;
  }
  if (dataType === "NUMBER") {
    const na = a === null || a === undefined || a === "" ? null : Number(a);
    const nb = b === null || b === undefined || b === "" ? null : Number(b);
    if (na === null && nb === null) return 0;
    if (na === null) return -1;
    if (nb === null) return 1;
    return na - nb;
  }
  return String(a ?? "").localeCompare(String(b ?? ""));
}
