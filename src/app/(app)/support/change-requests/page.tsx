import Link from "next/link";
import { requireMenu, canDecideChangeRequests } from "@/lib/auth";
import { SUPPORT_MENU } from "@/lib/support-schemas";
import { listChangeRequests } from "@/lib/change-requests";
import { formatDateTime } from "@/lib/report-format";
import { StatusPill } from "@/components/support/ticket-ui";
import DecisionPanel from "./DecisionPanel";

export default async function ChangeRequestsPage() {
  const session = await requireMenu(SUPPORT_MENU.CHANGE_REQUESTS);
  // Seeing the list and deciding on it are different rights (§4.6): the desk proposes,
  // Product/Ops signs off. The API enforces this again — this only decides what to render.
  const [requests, canDecide] = await Promise.all([
    listChangeRequests(),
    canDecideChangeRequests(session.userUid),
  ]);

  const pending = requests.filter((r) => r.approvalStatus === "PENDING");

  return (
    <div className="max-w-5xl">
      <div className="mb-5">
        <h1 className="text-xl font-semibold text-foreground">Change Requests</h1>
        <p className="text-sm text-foreground/60">
          Tickets that turned out to need development rather than a fix.{" "}
          {canDecide
            ? "You can approve or reject these."
            : "Product/Ops decides which of these go to the backlog."}
        </p>
      </div>

      {pending.length > 0 && (
        <div className="mb-5 rounded-md border border-warning-border bg-warning-surface p-3 text-sm text-foreground/80">
          {pending.length} awaiting a Product/Ops decision.
        </div>
      )}

      {requests.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-10 text-center text-sm text-foreground/70">
          No change requests yet. They&apos;re raised from a ticket.
        </div>
      ) : (
        <ul className="space-y-4">
          {requests.map((r) => (
            <li key={r.id} className="rounded-lg border border-border bg-card p-5 shadow-sm">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-mono text-xs font-semibold text-foreground">{r.crNo}</span>
                <StatusPill status={r.approvalStatus} />
                {r.backlogStatus && (
                  <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-xs text-foreground/70">
                    {r.backlogStatus.replace(/_/g, " ").toLowerCase()}
                    {r.targetRelease ? ` · ${r.targetRelease}` : ""}
                  </span>
                )}
              </div>

              <h2 className="mt-1 text-base font-semibold text-foreground">{r.title}</h2>
              <p className="mt-1 whitespace-pre-wrap text-sm text-foreground/80">{r.description}</p>

              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-foreground/60">
                <span>
                  From{" "}
                  <Link href={`/support/tickets/${r.ticket.id}`} className="font-mono text-link hover:underline">
                    {r.ticket.ticketNo}
                  </Link>{" "}
                  ({r.ticket.status.replace(/_/g, " ").toLowerCase()})
                </span>
                <span>Proposed by {r.requestedBy.fullName}</span>
                <span>{formatDateTime(r.requestedAt)}</span>
                {r.approvedBy && (
                  <span>
                    {r.approvalStatus === "APPROVED" ? "Approved" : "Rejected"} by {r.approvedBy.fullName}
                    {r.approvedAt ? ` · ${formatDateTime(r.approvedAt)}` : ""}
                  </span>
                )}
              </div>

              {r.approvalRemarks && (
                <p className="mt-2 rounded-md border border-border bg-surface p-2 text-xs text-foreground/75">
                  {r.approvalRemarks}
                </p>
              )}

              {canDecide && (
                <DecisionPanel
                  crId={r.id}
                  approvalStatus={r.approvalStatus}
                  backlogStatus={r.backlogStatus}
                  targetRelease={r.targetRelease}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
