import "server-only";
import { prisma } from "../db";
import { todayInIndia } from "./dates";
import { SPINE_INITIAL_LOAD_DATE } from "./ingest/curate-core";
import { ingestSpineRange, lastSucceededDate, purgeRawRows } from "./ingest/ingest";
import { SpineClient, spineCredentialsFromEnv } from "./ingest/spine-client";
import { SpineApiError } from "./ingest/spine-core";
import { runLifecycle } from "./lifecycle/lifecycle";
import { isStale, notAddedReasonKey, summarizeSync, type LifecycleCounts } from "./sync-job-core";

/**
 * Administration > HR Sync: one press = fetch everything Spine has that we have not seen, then
 * bring Synapse logins in line. Orchestrates the two disconnected processes in order — HR
 * ingestion (src/lib/hr/ingest), then the lifecycle (src/lib/hr/lifecycle) — exactly as
 * `npm run hr:ingest` then `npm run hr:lifecycle -- --apply --provision` would.
 *
 * What it may change on a login (SIHL, 2026-10-22): create a new employee's account, set the last
 * working date, deactivate a leaver, suspend on HR freeze (and lift that suspension on unfreeze).
 * Nothing else on User Master — that belongs to administrators and department heads.
 * No email is sent: the screen lists new usernames for the admin to hand over.
 */

export type StartResult = { ok: true; jobId: number } | { ok: false; reason: string; jobId?: number };

/** Mark dead RUNNING jobs FAILED so they do not block the button forever. */
async function failStaleJobs(): Promise<void> {
  const running = await prisma.hrSyncJob.findMany({ where: { status: "RUNNING" }, select: { id: true, startedAt: true } });
  for (const j of running) {
    if (isStale(j.startedAt)) {
      await prisma.hrSyncJob.update({
        where: { id: j.id },
        data: { status: "FAILED", finishedAt: new Date(), error: "Interrupted — the server stopped while this sync was running. Run it again." },
      });
    }
  }
}

/** Create the job row. The partial unique index refuses a second RUNNING job. */
export async function startHrSyncJob(startedBy: string): Promise<StartResult> {
  await failStaleJobs();
  try {
    const job = await prisma.hrSyncJob.create({ data: { startedBy, phase: "FETCHING" } });
    return { ok: true, jobId: job.id };
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") {
      const running = await prisma.hrSyncJob.findFirst({ where: { status: "RUNNING" }, select: { id: true, startedBy: true } });
      return { ok: false, reason: `A sync is already running${running ? ` (started by ${running.startedBy})` : ""}.`, jobId: running?.id };
    }
    throw err;
  }
}

function errorText(e: unknown): string {
  if (e instanceof SpineApiError) return e.message; // already sanitised: Spine echoes credentials
  return (e instanceof Error ? e.message : String(e)).slice(0, 300);
}

/** The work itself. Never throws: every outcome ends on the job row. */
export async function runHrSyncJob(jobId: number): Promise<void> {
  try {
    const today = todayInIndia();
    await purgeRawRows();

    // 1. HR ingestion: every Spine date not yet fetched (the initial load if none ever was).
    const from = (await lastSucceededDate()) ? undefined : SPINE_INITIAL_LOAD_DATE;
    const runs = await ingestSpineRange(new SpineClient(spineCredentialsFromEnv()), { today, from });
    const failed = runs.find((r) => r.status === "FAILED");
    if (failed) {
      // Stop before touching logins: they would be judged against a half-fetched picture.
      await prisma.hrSyncJob.update({
        where: { id: jobId },
        data: {
          status: "FAILED",
          phase: "DONE",
          finishedAt: new Date(),
          error: `Fetching ${failed.reqDate} from HR failed: ${failed.error ?? "unknown error"}`,
          summary: JSON.parse(JSON.stringify(summarizeSync(runs, 0, emptyLogins()))),
        },
      });
      return;
    }
    await prisma.hrSyncJob.update({ where: { id: jobId }, data: { phase: "APPLYING" } });

    // "Resigned": employees whose status moved to not-employed in the runs this job made.
    const resigned = runs.length
      ? await prisma.hrEmployeeChange.count({
          where: {
            runId: { in: runs.map((r) => r.runId) },
            field: "employmentStatus",
            oldValue: "ACTIVE",
            newValue: { not: "ACTIVE" },
          },
        })
      : 0;

    // 2. Lifecycle: logins.
    const life = await runLifecycle({ today, apply: true, provision: true });
    const notAdded: Record<string, number> = {};
    for (const b of life.provisioning.blocked) {
      const k = notAddedReasonKey(b.reason);
      notAdded[k] = (notAdded[k] ?? 0) + 1;
    }
    const logins: LifecycleCounts = {
      created: life.provisioning.created.length,
      createdUids: life.provisioning.created.map((c) => c.uid),
      deactivated: life.outcomes.filter((o) => o.applied).length,
      suspended: life.outcomes.filter((o) => o.freezeApplied && o.freeze.kind === "SUSPEND").length,
      unsuspended: life.outcomes.filter((o) => o.freezeApplied && o.freeze.kind === "UNSUSPEND").length,
      lastWorkingDateSet: life.outcomes.filter((o) => o.lastWorkingDateUpdated).length,
      reviewsRaised: life.outcomes.filter((o) => o.decision.kind === "REVIEW").length,
      notAdded,
    };

    await prisma.hrSyncJob.update({
      where: { id: jobId },
      data: {
        status: "SUCCEEDED",
        phase: "DONE",
        finishedAt: new Date(),
        summary: JSON.parse(JSON.stringify(summarizeSync(runs, resigned, logins))),
      },
    });
  } catch (e) {
    await prisma.hrSyncJob
      .update({ where: { id: jobId }, data: { status: "FAILED", phase: "DONE", finishedAt: new Date(), error: errorText(e) } })
      .catch(() => {});
  }
}

function emptyLogins(): LifecycleCounts {
  return { created: 0, createdUids: [], deactivated: 0, suspended: 0, unsuspended: 0, lastWorkingDateSet: 0, reviewsRaised: 0, notAdded: {} };
}
