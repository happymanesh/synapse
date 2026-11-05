/**
 * Turning a column's `linkUrlTemplate` into an href for one row.
 *
 * Pure and free of `server-only` so the rules — especially the safety ones — are unit
 * tested directly (tests/report-link-core.test.ts).
 *
 * The template is administrator-authored configuration, and the values interpolated into it
 * come from report data. Both are more trusted than end-user input and neither is trusted
 * enough to put straight into an href, so this only ever emits a same-origin app path.
 */

const PLACEHOLDER = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/**
 * `/support/tickets/{ticket_id}` + a row -> `/support/tickets/42`, or null.
 *
 * Returns null rather than a half-built URL when anything is missing: a link to
 * `/support/tickets/` or `/support/tickets/undefined` is worse than plain text, because it
 * looks clickable and lands on a 404.
 */
export function buildCellLink(
  template: string | null | undefined,
  row: Record<string, unknown>
): string | null {
  if (!template) return null;

  let missing = false;
  const href = template.replace(PLACEHOLDER, (_whole, column: string) => {
    const value = row[column];
    if (value === null || value === undefined || value === "") {
      missing = true;
      return "";
    }
    // Encoded per segment: a ticket number or code could contain a character that would
    // otherwise change the shape of the path.
    return encodeURIComponent(String(value));
  });
  if (missing) return null;

  // Same-origin paths only. This rejects `javascript:` and `data:` URLs, absolute links to
  // another site, and protocol-relative `//evil.example` — which browsers resolve as an
  // external host even though it starts with a slash.
  if (!href.startsWith("/") || href.startsWith("//")) return null;

  return href;
}
