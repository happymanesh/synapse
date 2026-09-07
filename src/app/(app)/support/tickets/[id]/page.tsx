import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { formatDateTime } from "@/lib/report-format";
import {
  canLogForOthers,
  findDuplicatesFor,
  getTicketForViewer,
  listForwardTargets,
  suggestIdentityMatches,
} from "@/lib/tickets";
import { allowedTransitions, canProposeChangeRequest, canReconcile } from "@/lib/ticket-core";
import { StatusPill } from "@/components/support/ticket-ui";
import TicketActions from "./TicketActions";
import DuplicateSuggestions from "./DuplicateSuggestions";
import ReconcilePanel from "./ReconcilePanel";
import ProposeChangeRequest from "./ProposeChangeRequest";

export default async function TicketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { id } = await params;
  const ticketId = Number(id);
  if (!Number.isInteger(ticketId)) notFound();

  // Returns null for someone else's ticket as well as for a missing one, so this 404 does
  // not let a probe tell the two apart.
  const ticket = await getTicketForViewer(ticketId, session.userUid, session.username);
  if (!ticket) notFound();

  const isStaff = await canLogForOthers(session.userUid);
  const isAbsorbed = ticket.mergedIntoTicketId !== null;
  const needsReconciling = isStaff && canReconcile(ticket);

  // Duplicates and forward targets are only fetched for staff who can act on them.
  const [duplicates, forwardTargets, identityMatches] = isStaff && !isAbsorbed
    ? await Promise.all([
        findDuplicatesFor(ticket),
        listForwardTargets(ticket.companyCode),
        needsReconciling ? suggestIdentityMatches(ticket) : Promise.resolve([]),
      ])
    : [[], [], []];

  const raiserLabel =
    ticket.raiser?.fullName ??
    ticket.guestName ??
    (ticket.raiserType === "GUEST" ? "Guest (no name captured)" : "Unknown");

  return (
    <div className="max-w-5xl">
      <Link href={isStaff ? "/support/queue" : "/support/tickets"} className="text-sm text-link hover:underline">
        ← Back to {isStaff ? "triage queue" : "my tickets"}
      </Link>

      <div className="mt-3 mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <span className="font-mono text-sm font-semibold text-foreground">{ticket.ticketNo}</span>
            <StatusPill status={isAbsorbed ? "MERGED" : ticket.status} />
          </div>
          <h1 className="mt-1 text-xl font-semibold text-foreground">{ticket.subject}</h1>
        </div>
      </div>

      {isAbsorbed && ticket.mergedInto && (
        <div className="mb-5 rounded-md border border-warning-border bg-warning-surface p-3 text-sm text-foreground/80">
          This ticket was merged into{" "}
          <Link href={`/support/tickets/${ticket.mergedInto.id}`} className="font-semibold text-link hover:underline">
            {ticket.mergedInto.ticketNo}
          </Link>{" "}
          and is no longer tracked separately. Act on that thread instead.
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card title="Description">
            <p className="whitespace-pre-wrap text-sm text-foreground/80">{ticket.description}</p>
          </Card>

          {ticket.mergedTickets.length > 0 && (
            <Card title={`Merged into this thread (${ticket.mergedTickets.length})`}>
              <ul className="space-y-2 text-sm">
                {ticket.mergedTickets.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-3">
                    <span className="text-foreground/80">{m.subject}</span>
                    <Link href={`/support/tickets/${m.id}`} className="font-mono text-xs text-link hover:underline">
                      {m.ticketNo}
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {needsReconciling && (
            <ReconcilePanel
              ticketId={ticket.id}
              capturedAs={
                [ticket.guestName, ticket.guestEmail, ticket.guestMobile].filter(Boolean).join(", ") ||
                "no contact details"
              }
              suggestions={identityMatches.map((p) => ({
                uid: p.uid,
                fullName: p.fullName,
                username: p.username,
                email: p.email,
                mobile: p.mobile,
                isActive: p.isActive,
              }))}
            />
          )}

          {isStaff && !isAbsorbed && duplicates.length > 0 && (
            <DuplicateSuggestions
              ticketId={ticket.id}
              ticketNo={ticket.ticketNo}
              candidates={duplicates.map((d) => ({
                id: d.id,
                ticketNo: d.ticketNo,
                subject: d.subject,
                raisedAt: formatDateTime(d.raisedAt),
                status: d.status,
              }))}
            />
          )}

          <Card title="History">
            {/* The audit trail (§5). Append-only, so this is the whole life of the ticket. */}
            <ol className="space-y-3">
              {ticket.events.map((e) => (
                <li key={e.id} className="border-l-2 border-border pl-3">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-foreground/70">
                      {e.eventType.replace(/_/g, " ").toLowerCase()}
                    </span>
                    <span className="text-xs text-foreground/50">
                      {formatDateTime(e.createdAt)} · {e.actorUsername}
                    </span>
                  </div>
                  {(e.fromStatus || e.toStatus) && (
                    <div className="mt-1 text-xs text-foreground/60">
                      {e.fromStatus ?? "—"} → {e.toStatus ?? "—"}
                    </div>
                  )}
                  {e.toUsername && (
                    <div className="mt-1 text-xs text-foreground/60">
                      to {e.toUsername}
                      {e.fromUsername ? ` (from ${e.fromUsername})` : ""}
                    </div>
                  )}
                  {e.revisedEta && (
                    <div className="mt-1 text-xs text-foreground/60">New ETA: {formatDateTime(e.revisedEta)}</div>
                  )}
                  {e.remarks && <p className="mt-1 whitespace-pre-wrap text-sm text-foreground/80">{e.remarks}</p>}
                </li>
              ))}
            </ol>
          </Card>

          {isStaff && canProposeChangeRequest({
            status: ticket.status,
            mergedIntoTicketId: ticket.mergedIntoTicketId,
            hasChangeRequest: ticket.changeRequest !== null,
          }) && <ProposeChangeRequest ticketId={ticket.id} defaultTitle={ticket.subject} />}

          {ticket.changeRequest && (
            <Card title="Change request">
              <div className="flex flex-wrap items-baseline gap-2 text-sm">
                <span className="font-mono text-xs font-semibold text-foreground">{ticket.changeRequest.crNo}</span>
                <StatusPill status={ticket.changeRequest.approvalStatus} />
                {ticket.changeRequest.backlogStatus && (
                  <span className="text-xs text-foreground/60">
                    backlog: {ticket.changeRequest.backlogStatus.replace(/_/g, " ").toLowerCase()}
                    {ticket.changeRequest.targetRelease ? ` · ${ticket.changeRequest.targetRelease}` : ""}
                  </span>
                )}
              </div>
              <p className="mt-2 text-sm text-foreground/85">{ticket.changeRequest.title}</p>
              {ticket.changeRequest.approvalStatus === "PENDING" && (
                <p className="mt-2 text-xs text-foreground/60">Awaiting a Product/Ops decision.</p>
              )}
              <Link
                href="/support/change-requests"
                className="mt-2 inline-block text-xs text-link hover:underline"
              >
                Open in Change Requests →
              </Link>
            </Card>
          )}

          {isStaff && !isAbsorbed && (
            <TicketActions
              ticketId={ticket.id}
              currentStatus={ticket.status}
              allowedStatuses={allowedTransitions(ticket.status).filter((s) => s !== "AWAITING_CR_APPROVAL")}
              forwardTargets={forwardTargets.map((u) => ({ uid: u.uid, name: u.fullName }))}
            />
          )}
        </div>

        <div className="space-y-5">
          <Card title="Details">
            <dl className="space-y-2 text-sm">
              <Row label="Raised by" value={raiserLabel} />
              <Row label="Type" value={ticket.raiserType.toLowerCase()} />
              {ticket.raiser?.email && <Row label="Email" value={ticket.raiser.email} />}
              {ticket.guestEmail && <Row label="Email" value={ticket.guestEmail} />}
              {ticket.raiser?.mobile && <Row label="Mobile" value={ticket.raiser.mobile} />}
              {ticket.guestMobile && <Row label="Mobile" value={ticket.guestMobile} />}
              {ticket.clientCode && <Row label="Client code" value={ticket.clientCode} />}
              <Row label="Channel" value={ticket.channel} />
              <Row label="Category" value={ticket.category.categoryName} />
              <Row label="Module" value={ticket.category.productModule} />
              <Row label="Assigned to" value={ticket.assignedTo?.fullName ?? "Unassigned"} />
              <Row label="Logged by" value={ticket.createdBy} />
            </dl>
          </Card>

          <Card title="Timing">
            <dl className="space-y-2 text-sm">
              <Row label="Raised" value={formatDateTime(ticket.raisedAt)} />
              {/* Differs from Raised only after a merge, when it moves to the earlier of the
                  two tickets — which is precisely when it is worth seeing. */}
              <Row label="Clock started" value={formatDateTime(ticket.slaClockStartAt)} />
              <Row label="First response" value={ticket.firstResponseAt ? formatDateTime(ticket.firstResponseAt) : "—"} />
              <Row label="Revised ETA" value={ticket.revisedEta ? formatDateTime(ticket.revisedEta) : "—"} />
              <Row label="Resolved" value={ticket.resolvedAt ? formatDateTime(ticket.resolvedAt) : "—"} />
              <Row label="Closed" value={ticket.closedAt ? formatDateTime(ticket.closedAt) : "—"} />
            </dl>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="shrink-0 text-foreground/55">{label}</dt>
      <dd className="text-right text-foreground/85">{value}</dd>
    </div>
  );
}
