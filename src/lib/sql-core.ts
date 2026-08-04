/**
 * Pure SQL-building logic for the report/form engine.
 *
 * Deliberately free of `server-only` and of any Prisma import so it can be unit tested
 * directly (see tests/sql-core.test.ts). The server-only execution layer lives in
 * report-sql.ts and re-exports everything here.
 *
 * TRUST BOUNDARY. Query *text* (templates, table and column names) comes from
 * administrator-authored rows and is only reachable through requireAdmin()-gated routes.
 * Runtime *values* — anything an end user submits — are never concatenated into SQL; they
 * become bound parameters. `assertSelectOnly` narrows the first half of that boundary: even
 * a trusted author (or a compromised admin account) cannot make the engine write data.
 */

export interface BoundQuery {
  sql: string;
  params: unknown[];
}

const NAMED_PARAM_PATTERN = /(?<!:):([a-zA-Z_][a-zA-Z0-9_]*)/g;
const SAFE_IDENTIFIER_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export function assertSafeIdentifier(name: string): void {
  if (!SAFE_IDENTIFIER_PATTERN.test(name)) {
    throw new Error(`Unsafe SQL identifier: ${name}`);
  }
}

// ---------------------------------------------------------------------------
// Read-only statement guard
// ---------------------------------------------------------------------------

/**
 * Writing constructs, matched by syntactic *shape* rather than by bare keyword.
 *
 * A bare word list is too blunt: `SELECT start, end FROM trip` or a column called
 * `last_update` would be rejected. Requiring the keyword to be followed by what actually
 * makes it a statement (`DELETE FROM`, `UPDATE <table>`, `CREATE <something>`) keeps
 * legitimate reads working while still catching real writes.
 *
 * Statements that cannot appear inside a SELECT or WITH at all (BEGIN, SET, LISTEN …) need
 * no entry here — they are already unreachable given the "must start with SELECT/WITH" and
 * "single statement" rules below.
 */
const WRITE_PATTERNS: { label: string; pattern: RegExp }[] = [
  { label: "INSERT", pattern: /\bINSERT\s+INTO\b/i },
  { label: "UPDATE", pattern: /\bUPDATE\s+["a-zA-Z_]/i },
  { label: "DELETE", pattern: /\bDELETE\s+FROM\b/i },
  { label: "MERGE", pattern: /\bMERGE\s+INTO\b/i },
  { label: "TRUNCATE", pattern: /\bTRUNCATE\s+/i },
  { label: "DROP", pattern: /\bDROP\s+["a-zA-Z_]/i },
  { label: "ALTER", pattern: /\bALTER\s+["a-zA-Z_]/i },
  { label: "CREATE", pattern: /\bCREATE\s+["a-zA-Z_]/i },
  { label: "GRANT", pattern: /\bGRANT\s+["a-zA-Z_]/i },
  { label: "REVOKE", pattern: /\bREVOKE\s+["a-zA-Z_]/i },
  { label: "COPY", pattern: /\bCOPY\s+["a-zA-Z_]/i },
  { label: "VACUUM", pattern: /\bVACUUM\b/i },
  { label: "REINDEX", pattern: /\bREINDEX\b/i },
  { label: "CALL", pattern: /\bCALL\s+["a-zA-Z_]/i },
  { label: "DO block", pattern: /\bDO\s+\$\$/i },
];

/**
 * Blanks out comments and string/identifier literals so keyword scanning can't be fooled
 * by `'-- not really a comment'` or hidden by `/* *​/`, and so a column named
 * `updated_on` or a literal `'delete me'` doesn't trip a false positive.
 * Replaced with spaces rather than removed so offsets stay comparable.
 */
function blankLiteralsAndComments(sql: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const two = sql.slice(i, i + 2);
    if (two === "--") {
      while (i < sql.length && sql[i] !== "\n") { out += " "; i++; }
    } else if (two === "/*") {
      let depth = 1;
      out += "  ";
      i += 2;
      while (i < sql.length && depth > 0) {
        if (sql.slice(i, i + 2) === "/*") { depth++; out += "  "; i += 2; }
        else if (sql.slice(i, i + 2) === "*/") { depth--; out += "  "; i += 2; }
        else { out += " "; i++; }
      }
    } else if (sql[i] === "'" || sql[i] === '"') {
      const quote = sql[i];
      out += " ";
      i++;
      while (i < sql.length) {
        if (sql[i] === quote) {
          // Doubled quote is an escaped quote inside the literal, not the end.
          if (sql[i + 1] === quote) { out += "  "; i += 2; continue; }
          out += " "; i++; break;
        }
        out += " "; i++;
      }
    } else {
      out += sql[i];
      i++;
    }
  }
  return out;
}

/**
 * Rejects anything that isn't a single read-only statement.
 *
 * Three distinct bypasses this has to stop:
 *  1. Outright `DELETE FROM ...` as the statement.
 *  2. `SELECT 1; DROP TABLE x` — a second statement smuggled after a semicolon.
 *  3. `WITH x AS (DELETE FROM t RETURNING *) SELECT * FROM x` — Postgres genuinely allows
 *     data-modifying statements inside a CTE, so "starts with WITH" is not sufficient.
 */
export function assertSelectOnly(template: string): void {
  const scrubbed = blankLiteralsAndComments(template);
  const trimmed = scrubbed.trim();

  if (trimmed === "") {
    throw new Error("Report query is empty.");
  }

  const firstWord = trimmed.match(/^([a-zA-Z]+)/)?.[1]?.toUpperCase();
  if (firstWord !== "SELECT" && firstWord !== "WITH" && firstWord !== "TABLE" && firstWord !== "VALUES") {
    throw new Error(
      `Report queries must be read-only and begin with SELECT or WITH (found "${firstWord ?? "?"}").`
    );
  }

  // Anything after a semicolon means a second statement. A single trailing ; is fine.
  const semicolon = trimmed.indexOf(";");
  if (semicolon !== -1 && trimmed.slice(semicolon + 1).trim() !== "") {
    throw new Error("Report queries must be a single statement; remove the ';' and anything after it.");
  }

  for (const { label, pattern } of WRITE_PATTERNS) {
    if (pattern.test(scrubbed)) {
      throw new Error(`Report queries may not contain ${label} — they must only read data.`);
    }
  }
}

// ---------------------------------------------------------------------------
// Session scoping
// ---------------------------------------------------------------------------

export interface SessionScope {
  companyCode: string;
  hierarchyCode: string;
  username: string;
  userUid: number;
}

/**
 * Reserved parameter names a report query may reference to scope itself to the caller,
 * e.g. `WHERE company_code = :SESSION_COMPANY`. Supplied by the engine, so a report author
 * can never be handed a spoofed value.
 */
export const SESSION_PARAM_NAMES = [
  "SESSION_COMPANY",
  "SESSION_HIERARCHY",
  "SESSION_USER",
  "SESSION_USER_UID",
] as const;

/**
 * Overlays the reserved session parameters onto the submitted values.
 * Applied last and unconditionally: a filter component sharing one of these names must not
 * be able to override the caller's real identity.
 */
export function withSessionParams(
  values: Record<string, unknown>,
  scope: SessionScope
): Record<string, unknown> {
  return {
    ...values,
    SESSION_COMPANY: scope.companyCode,
    SESSION_HIERARCHY: scope.hierarchyCode,
    SESSION_USER: scope.username,
    SESSION_USER_UID: scope.userUid,
  };
}

// ---------------------------------------------------------------------------
// Value handling
// ---------------------------------------------------------------------------

/**
 * A form field left blank submits "" (or is missing entirely), not null — and "" is a real,
 * distinct SQL value ("status = ''" matches nothing, it doesn't mean "no filter"). Every
 * place that builds paramValues from submitted form values must route through this so an
 * empty field means "not filtered."
 */
export function resolveFilterValue(submitted: unknown, defaultValue: unknown): unknown {
  if (submitted === undefined || submitted === null || submitted === "") {
    return defaultValue === undefined || defaultValue === "" ? null : defaultValue;
  }
  return submitted;
}

/** Whether a submitted value satisfies a mandatory filter/field — DATE_RANGE needs both halves. */
export function isFilterValuePresent(componentType: string, value: unknown): boolean {
  if (value === undefined || value === null || value === "") return false;
  if (componentType === "DATE_RANGE") {
    const [from, to] = String(value).split(",");
    return !!from && !!to;
  }
  return true;
}

export interface FilterItemForBinding {
  componentCode: string;
  defaultValue: string | null;
  componentType: string;
}

/**
 * Builds the {paramName: value} map used to bind a report's queryText. DATE_RANGE is the one
 * component type needing two SQL parameters from a single filter item — the client stores it
 * as one "from,to" string, but a query needs separate :CODE_FROM / :CODE_TO placeholders.
 */
export function buildParamValues(
  items: FilterItemForBinding[],
  submittedValues: Record<string, unknown>
): Record<string, unknown> {
  const paramValues: Record<string, unknown> = {};
  for (const item of items) {
    const raw = submittedValues[item.componentCode];
    if (item.componentType === "DATE_RANGE") {
      const combined = typeof raw === "string" && raw !== "" ? raw : (item.defaultValue ?? "");
      const [from, to] = combined.split(",");
      paramValues[`${item.componentCode}_FROM`] = from || null;
      paramValues[`${item.componentCode}_TO`] = to || null;
    } else {
      paramValues[item.componentCode] = resolveFilterValue(raw, item.defaultValue);
    }
  }
  return paramValues;
}

// ---------------------------------------------------------------------------
// Binding and wrapping
// ---------------------------------------------------------------------------

/** Replaces :paramName tokens with positional $1/$2/... placeholders, building a matching params array. */
export function bindNamedParams(template: string, values: Record<string, unknown>): BoundQuery {
  const params: unknown[] = [];
  const paramIndex = new Map<string, number>();

  const sql = template.replace(NAMED_PARAM_PATTERN, (_match, name: string) => {
    let index = paramIndex.get(name);
    if (index === undefined) {
      params.push(values[name] ?? null);
      index = params.length;
      paramIndex.set(name, index);
    }
    return `$${index}`;
  });

  return { sql, params };
}

/**
 * Wraps an already-bound query so a column must equal a value the engine supplies.
 * Shared by FORM-mode ownership and REPORT-mode company scoping — both need the predicate
 * to live in the statement rather than depend on the query author remembering it.
 */
export function wrapWithScope(bound: BoundQuery, column: string, value: unknown, alias: string): BoundQuery {
  assertSafeIdentifier(column);
  assertSafeIdentifier(alias);
  return {
    sql: `SELECT * FROM (${bound.sql}) ${alias} WHERE ${alias}.${column} = $${bound.params.length + 1}`,
    params: [...bound.params, value],
  };
}
