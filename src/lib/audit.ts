import "server-only";
import type { PrismaClient } from "../../generated/prisma/client";
import { diffRecords, isAuditedModel, recordIdOf, redact, SYSTEM_ACTOR, type AuditAction } from "@/lib/audit-core";

/**
 * Records every administrative write, by extending the Prisma client rather than by
 * calling a helper from each route.
 *
 * 34 route files under src/app/api/admin perform writes. A `recordAudit(...)` call in each
 * is 34 chances to forget, and the 35th route — written months from now by someone who has
 * not read this file — would simply not be audited, silently. Hooking the one path every
 * write already goes through is the same reasoning that put the isActive check inside
 * getSession() instead of at its call sites.
 *
 * What is deliberately NOT audited:
 *  - writes with no signed-in request behind them (seed, scripts, the HR sync job). The
 *    seed alone performs hundreds of upserts on every deploy; recording them would bury
 *    the handful of human changes an auditor is actually looking for. Those paths have
 *    their own logs (hr_ingest_run, hr_employee_change).
 *  - the high-volume append-only logs themselves (see SKIPPED_MODELS in audit-core).
 */

type ActorInfo = { actorUid: number | null; actorUsername: string; ipAddress: string | null };

/**
 * The signed-in user, or null when there is no request behind this write.
 *
 * getSession() reads cookies via next/headers, which throws outside a request scope — that
 * throw is how a script is distinguished from a user action, so it is caught, not avoided.
 * Imported dynamically to break the cycle db -> audit -> session -> db.
 */
async function currentActor(): Promise<ActorInfo | null> {
  try {
    const [{ getSession }, { headers }] = await Promise.all([
      import("@/lib/session"),
      import("next/headers"),
    ]);
    const session = await getSession();
    if (!session) return null;
    let ipAddress: string | null = null;
    try {
      const { getClientIp } = await import("@/lib/ip-match");
      ipAddress = getClientIp(await headers());
    } catch {
      // Header access can be unavailable in some server contexts; the actor still matters more.
    }
    return { actorUid: session.userUid, actorUsername: session.username, ipAddress };
  } catch {
    return null;
  }
}

/** Write operations worth recording, and whether the previous state has to be read first. */
const WRITE_OPS: Record<string, { action: AuditAction; needsBefore: boolean }> = {
  create: { action: "CREATE", needsBefore: false },
  update: { action: "UPDATE", needsBefore: true },
  delete: { action: "DELETE", needsBefore: true },
  upsert: { action: "UPDATE", needsBefore: true },
  updateMany: { action: "UPDATE", needsBefore: false },
  deleteMany: { action: "DELETE", needsBefore: false },
  createMany: { action: "CREATE", needsBefore: false },
};

export function withAudit(base: PrismaClient): PrismaClient {
  return base.$extends({
    name: "audit",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const spec = WRITE_OPS[operation];
          if (!spec || !isAuditedModel(model)) return query(args);

          const actor = await currentActor();
          // No signed-in request: a script or the seed. Not audited — see the note above.
          if (!actor) return query(args);

          // Read the previous state before the write destroys it. Best-effort: a composite
          // or non-unique `where` makes this unreadable, and a missing before-image must
          // never be a reason to block the write itself.
          let before: Record<string, unknown> | null = null;
          if (spec.needsBefore) {
            try {
              const where = (args as { where?: unknown }).where;
              if (where) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                before = await (base as any)[model as string].findUnique({ where });
              }
            } catch {
              before = null;
            }
          }

          const result = await query(args);

          // The audit write is deliberately outside the caller's success path: a failure to
          // record must not roll back or fail the change the user just made. It is logged
          // loudly instead, because silent gaps in an audit trail are worse than noise.
          try {
            const after = (result ?? null) as Record<string, unknown> | null;
            const changes =
              spec.action === "UPDATE" && before
                ? diffRecords(before, after)
                : (redact(spec.action === "DELETE" ? (before ?? after) : after) as Record<string, unknown> | null);

            // An update that changed nothing is not an event.
            if (spec.action === "UPDATE" && before && Object.keys(changes ?? {}).length === 0) return result;

            await base.auditLog.create({
              data: {
                actorUid: actor.actorUid,
                actorUsername: actor.actorUsername || SYSTEM_ACTOR,
                action: spec.action,
                model: model as string,
                recordId: recordIdOf(after) ?? recordIdOf(before),
                changes: (changes ?? {}) as never,
                ipAddress: actor.ipAddress,
              },
            });
          } catch (err) {
            console.error("[audit] failed to record", model, operation, err);
          }

          return result;
        },
      },
    },
  }) as unknown as PrismaClient;
}
