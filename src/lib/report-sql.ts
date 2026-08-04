import "server-only";
import { prisma, prismaReadOnly } from "@/lib/db";
import {
  assertSafeIdentifier,
  assertSelectOnly,
  bindNamedParams,
  wrapWithScope,
  type BoundQuery,
  type SessionScope,
} from "@/lib/sql-core";

/**
 * Server-only execution layer for the report/form engine. All the pure logic — binding,
 * identifier safety, the read-only statement guard, session scoping — lives in sql-core.ts
 * so it can be unit tested; this file only decides *how* and *against which connection* a
 * query runs.
 *
 * Two rules hold everywhere below:
 *  1. Administrator-authored templates always pass through assertSelectOnly() before
 *     execution, and always run on the read-only connection.
 *  2. Engine-built writes (INSERT/UPDATE/DELETE for FORM mode) are assembled here from a
 *     table name plus column names — never from free text — and run on the main connection.
 */

export * from "@/lib/sql-core";

// ---------------------------------------------------------------------------
// Reads — administrator-authored templates
// ---------------------------------------------------------------------------

/** Binds an admin template after proving it is read-only. Every read path starts here. */
export function bindReportTemplate(template: string, values: Record<string, unknown>): BoundQuery {
  assertSelectOnly(template);
  return bindNamedParams(template, values);
}

/** Executes a already-bound read on the read-only connection. */
export async function runBoundQuery<T = Record<string, unknown>>(bound: BoundQuery): Promise<T[]> {
  return prismaReadOnly.$queryRawUnsafe<T[]>(bound.sql, ...bound.params);
}

export async function runParameterizedQuery<T = Record<string, unknown>>(
  template: string,
  values: Record<string, unknown>
): Promise<T[]> {
  return runBoundQuery<T>(bindReportTemplate(template, values));
}

/** Runs COUNT(*) around a template without fetching the underlying rows — used for the maxRows guard. */
export async function countParameterizedQuery(template: string, values: Record<string, unknown>): Promise<number> {
  const { sql, params } = bindReportTemplate(template, values);
  const wrapped = `SELECT COUNT(*)::int AS count FROM (${sql}) __count_wrapper`;
  const result = await prismaReadOnly.$queryRawUnsafe<{ count: number }[]>(wrapped, ...params);
  return result[0]?.count ?? 0;
}

/**
 * Applies the company scope a report opts into via ReportDefinition.companyScopeColumn.
 *
 * REPORT mode used to rely entirely on the query author remembering a company predicate,
 * while FORM mode enforced ownership itself — an asymmetry that made cross-company leakage
 * a single forgotten WHERE clause away. When the column is configured the predicate is now
 * applied by the engine, exactly as ownership is.
 */
export function applyCompanyScope(
  bound: BoundQuery,
  companyScopeColumn: string | null,
  scope: SessionScope
): BoundQuery {
  if (!companyScopeColumn) return bound;
  return wrapWithScope(bound, companyScopeColumn, scope.companyCode, "__company_scope");
}

/** FORM mode "my records" list: binds the admin's template, then wraps it with an owner filter the engine enforces itself. */
export function bindAndWrapWithOwnership(
  template: string,
  values: Record<string, unknown>,
  ownerColumn: string,
  ownerValue: string
): BoundQuery {
  return wrapWithScope(bindReportTemplate(template, values), ownerColumn, ownerValue, "__owned_wrapper");
}

// ---------------------------------------------------------------------------
// Writes — engine-built, never from free text
// ---------------------------------------------------------------------------

/** Executes an engine-built write on the main (writable) connection. */
async function runWrite<T = Record<string, unknown>>(bound: BoundQuery): Promise<T[]> {
  return prisma.$queryRawUnsafe<T[]>(bound.sql, ...bound.params);
}

export async function runWriteQuery<T = Record<string, unknown>>(bound: BoundQuery): Promise<T[]> {
  return runWrite<T>(bound);
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
