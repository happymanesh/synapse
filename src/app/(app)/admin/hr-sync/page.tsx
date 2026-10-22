import { prisma } from "@/lib/db";
import HrSyncPanel, { type CreatedUser, type SyncJob } from "@/components/admin/HrSyncPanel";

/** Administration > HR Sync: fetch from the HR system on demand and see what changed. */
export default async function HrSyncPage() {
  const jobs = await prisma.hrSyncJob.findMany({ orderBy: { startedAt: "desc" }, take: 10 });
  const uids = ((jobs[0]?.summary as { logins?: { createdUids?: number[] } } | null)?.logins?.createdUids ?? []).slice(0, 500);
  const createdUsers = uids.length
    ? await prisma.userDetails.findMany({
        where: { uid: { in: uids } },
        select: { uid: true, username: true, fullName: true, employeeCode: true, department: true },
        orderBy: { username: "asc" },
      })
    : [];

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-foreground">HR Sync</h1>
      <HrSyncPanel
        initialJobs={JSON.parse(JSON.stringify(jobs)) as SyncJob[]}
        initialCreated={createdUsers as CreatedUser[]}
      />
    </div>
  );
}
