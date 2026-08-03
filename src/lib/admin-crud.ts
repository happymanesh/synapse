import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "../../generated/prisma/client";

export class FkConstraintError extends Error {}

/** Turns a Postgres FK-constraint violation on delete into a clear, catchable error. */
export async function withFkGuard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
      throw new FkConstraintError("Cannot delete — other records still reference this. Deactivate it instead.");
    }
    throw err;
  }
}

/** Shared error → HTTP response mapping for all /api/admin/* routes. */
export function adminErrorResponse(err: unknown): NextResponse {
  if (err instanceof FkConstraintError) {
    return NextResponse.json({ error: err.message }, { status: 409 });
  }
  if (err instanceof z.ZodError) {
    // Surface per-field messages too, so the form can highlight exactly which
    // input is wrong instead of just showing one generic banner.
    const fieldErrors: Record<string, string> = {};
    for (const issue of err.issues) {
      const field = String(issue.path[0] ?? "");
      if (field) fieldErrors[field] = fieldErrors[field] ? `${fieldErrors[field]} ${issue.message}` : issue.message;
    }
    return NextResponse.json(
      { error: err.issues.map((i) => i.message).join(" "), fieldErrors },
      { status: 400 }
    );
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    const target = Array.isArray(err.meta?.target) ? (err.meta.target as string[]) : [];
    return NextResponse.json(
      { error: "A record with this identifier already exists.", fieldErrors: fieldErrorsFromColumns(target) },
      { status: 409 }
    );
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
    const column = typeof err.meta?.field_name === "string" ? err.meta.field_name : "";
    return NextResponse.json(
      {
        error: "One of the selected references doesn't exist. Check the highlighted field.",
        fieldErrors: fieldErrorsFromColumns(columnNameFromConstraint(column)),
      },
      { status: 400 }
    );
  }
  console.error(err);
  return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
}

/** DB columns are snake_case; form field names are camelCase — bridge the two so the UI can key off them. */
function fieldErrorsFromColumns(columns: string[]): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const col of columns) {
    const field = col.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    fieldErrors[field] = "This value isn't valid.";
  }
  return fieldErrors;
}

/** Prisma's P2003 meta.field_name is a constraint name like "menu_master_report_id_fkey" — pull the column out of it. */
function columnNameFromConstraint(constraintName: string): string[] {
  const match = constraintName.match(/^(?:\w+?_)?([a-z0-9_]+)_fkey/);
  return match ? [match[1]] : [];
}
