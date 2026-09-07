import { requireMenu } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { SUPPORT_MENU } from "@/lib/support-schemas";
import { listDocumentRequests } from "@/lib/documents";
import { canLogForOthers } from "@/lib/tickets";
import { isClientHierarchy, DOCUMENT_TYPE_LABELS, type DocumentType } from "@/lib/document-core";
import { formatDate, formatDateTime } from "@/lib/report-format";
import { StatusPill } from "@/components/support/ticket-ui";
import DocumentRequestForm from "./DocumentRequestForm";

export default async function DocumentRequestsPage() {
  const session = await requireMenu(SUPPORT_MENU.DOCUMENTS);

  const [me, isStaff] = await Promise.all([
    prisma.userDetails.findUnique({
      where: { uid: session.userUid },
      select: { hierarchyCode: true, email: true, customerId: true },
    }),
    canLogForOthers(session.userUid),
  ]);
  const isClient = isClientHierarchy(me?.hierarchyCode ?? "");
  const requests = await listDocumentRequests(session.userUid, isStaff);

  return (
    <div className="max-w-5xl">
      <h1 className="mb-1 text-xl font-semibold text-foreground">Document Requests</h1>
      <p className="mb-5 max-w-3xl text-sm text-foreground/60">
        Ledgers, margin reports and contract notes. Documents are only ever sent to the address held in master data
        {isClient ? "." : ", and the client is always copied when someone requests on their behalf."}
      </p>

      <DocumentRequestForm isClient={isClient} />

      <h2 className="mt-8 mb-3 text-sm font-semibold text-foreground">
        {isStaff ? "All requests" : "Your requests"}
      </h2>

      {requests.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-10 text-center text-sm text-foreground/70">
          No document requests yet.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-surface text-left text-xs uppercase tracking-wide text-foreground/60">
              <tr>
                <th className="px-4 py-3 font-semibold">Reference</th>
                <th className="px-4 py-3 font-semibold">Document</th>
                <th className="px-4 py-3 font-semibold">Client</th>
                <th className="px-4 py-3 font-semibold">Period</th>
                <th className="px-4 py-3 font-semibold">Delivery</th>
                <th className="px-4 py-3 text-center font-semibold">Requested</th>
                <th className="px-4 py-3 text-center font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0 align-top hover:bg-surface/60">
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs font-semibold text-foreground">
                    {r.requestNo}
                  </td>
                  <td className="px-4 py-3 text-foreground/85">
                    {DOCUMENT_TYPE_LABELS[r.documentType as DocumentType] ?? r.documentType}
                  </td>
                  <td className="px-4 py-3 text-foreground/80">{r.clientCode ?? "—"}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-foreground/70">
                    {r.fromDate || r.toDate
                      ? `${r.fromDate ? formatDate(r.fromDate) : "…"} – ${r.toDate ? formatDate(r.toDate) : "…"}`
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-foreground/70">
                    <div>{r.deliverToEmail}</div>
                    {r.ccEmail && <div className="text-foreground/50">cc {r.ccEmail}</div>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-center text-foreground/80">
                    {formatDateTime(r.requestedAt)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <StatusPill status={r.status} />
                    {r.failureReason && (
                      <div className="mt-1 max-w-[16rem] text-left text-xs text-foreground/55">{r.failureReason}</div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
