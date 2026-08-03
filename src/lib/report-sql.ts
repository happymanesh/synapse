import "server-only";
import { prisma } from "@/lib/db";

export interface BoundQuery {
  sql: string;
  params: unknown[];
}

/**
 * Trust boundary for this whole module: query *text* (templates, table names,
 * column names) always comes from admin-authored FilterComponentMaster /
 * FilterDefinitionItem / ReportDefinition rows — only reachable via
 * requireAdmin()-gated routes — so it's trusted content, not attacker input.
 * Runtime *values* (whatever an end user submits in the filter form) are never
 * concatenated into SQL text; they're always passed as separate bound
 * parameters via $queryRawUnsafe's rest args, which the pg driver escapes.
 */

const NAMED_PARAM_PATTERN = /(?<!:):([a-zA-Z_][a-zA-Z0-9_]*)/g;
const SAFE_IDENTIFIER_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * A form field left blank submits "" (or is missing entirely), not null — and
 * "" is a real, distinct SQL value ("status = ''" matches nothing, it doesn't
 * mean "no filter"). Every place that builds paramValues from submitted form
 * values must route through this so an empty field means "not filtered."
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
 * Builds the {paramName: value} map used to bind a report's queryText.
 * DATE_RANGE is the one component type that needs two SQL parameters from a
 * single filter item — the client stores it as one "from,to" string, but a
 * query needs separate :CODE_FROM / :CODE_TO placeholders to filter a date
 * column, so it's expanded here rather than left as an unusable combined value.
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

function assertSafeIdentifier(name: string): void {
  if (!SAFE_IDENTIFIER_PATTERN.test(name)) {
    throw new Error(`Unsafe SQL identifier: ${name}`);
  }
}

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

export async function runBoundQuery<T = Record<string, unknown>>(bound: BoundQuery): Promise<T[]> {
  return prisma.$queryRawUnsafe<T[]>(bound.sql, ...bound.params);
}

export async function runParameterizedQuery<T = Record<string, unknown>>(
  template: string,
  values: Record<string, unknown>
): Promise<T[]> {
  return runBoundQuery<T>(bindNamedParams(template, values));
}

/** Runs COUNT(*) around a template without fetching the underlying rows — used for the maxRows guard. */
export async function countParameterizedQuery(template: string, values: Record<string, unknown>): Promise<number> {
  const { sql, params } = bindNamedParams(template, values);
  const wrapped = `SELECT COUNT(*)::int AS count FROM (${sql}) __count_wrapper`;
  const result = await prisma.$queryRawUnsafe<{ count: number }[]>(wrapped, ...params);
  return result[0]?.count ?? 0;
}

/** FORM mode "my records" list: binds the admin's template, then wraps it with an owner filter the engine enforces itself. */
export function bindAndWrapWithOwnership(
  template: string,
  values: Record<string, unknown>,
  ownerColumn: string,
  ownerValue: string
): BoundQuery {
  assertSafeIdentifier(ownerColumn);
  const { sql, params } = bindNamedParams(template, values);
  const wrapped = `SELECT * FROM (${sql}) __owned_wrapper WHERE __owned_wrapper.${ownerColumn} = $${params.length + 1}`;
  return { sql: wrapped, params: [...params, ownerValue] };
}

export function buildInsertQuery(table: string, columnValues: Record<string, unknown>): BoundQuery {
  assertSafeIdentifier(table);
  const columns = Object.keys(columnValues);
  columns.forEach(assertSafeIdentifier);
  const placeholders = columns.map((_, i) => `$${i + 1}`);
  const sql = `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING *`;
  return { sql, params: columns.map((c) => columnValues[c]) };
}

export function buildUpdateQuery(
  table: string,
  idColumn: string,
  idValue: unknown,
  columnValues: Record<string, unknown>
): BoundQuery {
  assertSafeIdentifier(table);
  assertSafeIdentifier(idColumn);
  const columns = Object.keys(columnValues);
  columns.forEach(assertSafeIdentifier);
  const setClauses = columns.map((c, i) => `${c} = $${i + 1}`);
  const sql = `UPDATE ${table} SET ${setClauses.join(", ")} WHERE ${idColumn} = $${columns.length + 1} RETURNING *`;
  return { sql, params: [...columns.map((c) => columnValues[c]), idValue] };
}

/** Updates only if idColumn AND ownerColumn both match — the ownership check lives in the query itself, not just the caller's logic. */
export function buildOwnedUpdateQuery(
  table: string,
  idColumn: string,
  idValue: unknown,
  ownerColumn: string,
  ownerValue: unknown,
  columnValues: Record<string, unknown>
): BoundQuery {
  assertSafeIdentifier(table);
  assertSafeIdentifier(idColumn);
  assertSafeIdentifier(ownerColumn);
  const columns = Object.keys(columnValues);
  columns.forEach(assertSafeIdentifier);
  const setClauses = columns.map((c, i) => `${c} = $${i + 1}`);
  const sql = `UPDATE ${table} SET ${setClauses.join(", ")} WHERE ${idColumn} = $${columns.length + 1} AND ${ownerColumn} = $${columns.length + 2} RETURNING *`;
  return { sql, params: [...columns.map((c) => columnValues[c]), idValue, ownerValue] };
}

/** Deletes only if idColumn AND ownerColumn both match — the ownership check lives in the query itself, not just the caller's logic. */
export function buildOwnedDeleteQuery(
  table: string,
  idColumn: string,
  idValue: unknown,
  ownerColumn: string,
  ownerValue: unknown
): BoundQuery {
  assertSafeIdentifier(table);
  assertSafeIdentifier(idColumn);
  assertSafeIdentifier(ownerColumn);
  const sql = `DELETE FROM ${table} WHERE ${idColumn} = $1 AND ${ownerColumn} = $2 RETURNING ${idColumn}`;
  return { sql, params: [idValue, ownerValue] };
}
