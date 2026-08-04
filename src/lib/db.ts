import { PrismaClient } from "../../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

declare global {
  var __prisma: PrismaClient | undefined;
  var __prismaReadOnly: PrismaClient | undefined;
}

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

export const prisma = globalThis.__prisma ?? new PrismaClient({ adapter });

/**
 * Second connection used ONLY to execute administrator-authored report queries.
 *
 * `assertSelectOnly` already rejects writing statements, but that is application-level: it
 * depends on the guard being correct and on every call site remembering to use it. Pointing
 * report execution at a Postgres role with no write grants makes the restriction structural,
 * so even a guard bypass cannot modify data — defence in depth, which matters here because
 * the query text is stored in the database and executed dynamically.
 *
 * Falls back to the main connection when DATABASE_URL_READONLY is unset so existing
 * deployments keep working; see REPORT_DB_IS_READONLY for whether the hard guarantee is
 * actually in force.
 */
const readOnlyUrl = process.env.DATABASE_URL_READONLY;

export const REPORT_DB_IS_READONLY = !!readOnlyUrl;

export const prismaReadOnly: PrismaClient = readOnlyUrl
  ? (globalThis.__prismaReadOnly ??
     new PrismaClient({ adapter: new PrismaPg({ connectionString: readOnlyUrl }) }))
  : prisma;

if (process.env.NODE_ENV !== "production") {
  globalThis.__prisma = prisma;
  if (readOnlyUrl) globalThis.__prismaReadOnly = prismaReadOnly;
}
