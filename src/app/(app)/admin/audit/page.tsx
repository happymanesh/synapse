import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { toAuditRow } from "@/lib/audit-rows";
import AuditTable from "@/components/admin/AuditTable";

const PAGE_SIZE = 20;

/**
 * Administration > Audit Trail: who changed what, and when.
 *
 * Read-only throughout — the page offers no mutation and the API route behind it exposes
 * only GET. Rows are written by the Prisma extension in src/lib/audit.ts, so this shows
 * every administrative change including ones made through routes added after it.
 */
export default async function AuditPage() {
  await requireAdmin();

  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({ orderBy: { occurredAt: "desc" }, take: PAGE_SIZE }),
    prisma.auditLog.count(),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="mb-1 text-xl font-semibold text-foreground">Audit Trail</h1>
        <p className="text-sm text-foreground/60">
          Every change made through Synapse, by whom and when. Records cannot be edited or deleted from
          here. Changes made by scripts and the HR sync are not shown — those have their own logs.
        </p>
      </div>
      <AuditTable initialRows={rows.map(toAuditRow)} initialTotal={total} pageSize={PAGE_SIZE} />
    </div>
  );
}
