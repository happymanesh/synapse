import { NextResponse, after } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { runHrSyncJob, startHrSyncJob } from "@/lib/hr/sync-job";

/**
 * Administration > HR Sync.
 *   POST  start a sync (fetch from HR, then update logins). Returns at once; the work runs in
 *         after() and its progress is on the hr_sync_job row. 409 if one is already running.
 *   GET   the latest jobs, plus the accounts the latest job created (to hand over in person).
 */
export async function POST() {
  const session = await requireAdmin();
  const started = await startHrSyncJob(session.username);
  if (!started.ok) return NextResponse.json({ error: started.reason, jobId: started.jobId }, { status: 409 });
  after(() => runHrSyncJob(started.jobId));
  return NextResponse.json({ jobId: started.jobId }, { status: 202 });
}

export async function GET() {
  await requireAdmin();
  const jobs = await prisma.hrSyncJob.findMany({ orderBy: { startedAt: "desc" }, take: 10 });
  const latest = jobs[0];
  const uids = ((latest?.summary as { logins?: { createdUids?: number[] } } | null)?.logins?.createdUids ?? []).slice(0, 500);
  const createdUsers = uids.length
    ? await prisma.userDetails.findMany({
        where: { uid: { in: uids } },
        select: { uid: true, username: true, fullName: true, employeeCode: true, department: true },
        orderBy: { username: "asc" },
      })
    : [];
  return NextResponse.json({ jobs, createdUsers });
}
