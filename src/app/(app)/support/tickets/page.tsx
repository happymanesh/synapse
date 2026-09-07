import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { listMyTickets } from "@/lib/tickets";
import { formatDateTime } from "@/lib/report-format";
import { StatusPill } from "@/components/support/ticket-ui";

export default async function MyTicketsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const tickets = await listMyTickets(session.userUid, session.username);

  return (
    <div>
      <div className="mb-5 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">My Tickets</h1>
          <p className="text-sm text-foreground/60">Tickets you raised, and calls you logged for others.</p>
        </div>
        <Link
          href="/support/tickets/new"
          className="btn-brand shrink-0 rounded-md px-4 py-2 text-sm font-semibold hover:opacity-90"
        >
          Raise a ticket
        </Link>
      </div>

      {tickets.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-10 text-center">
          <p className="text-sm text-foreground/70">No tickets yet.</p>
          <Link href="/support/tickets/new" className="mt-2 inline-block text-sm font-medium text-link hover:underline">
            Raise your first one
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-surface text-left text-xs uppercase tracking-wide text-foreground/60">
              <tr>
                <th className="px-4 py-3 font-semibold">Ticket</th>
                <th className="px-4 py-3 font-semibold">Subject</th>
                <th className="px-4 py-3 font-semibold">Category</th>
                <th className="px-4 py-3 text-center font-semibold">Channel</th>
                <th className="px-4 py-3 text-center font-semibold">Raised</th>
                <th className="px-4 py-3 text-center font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => (
                <tr key={t.id} className="border-b border-border last:border-0 hover:bg-surface/60">
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs font-semibold">
                    <Link href={`/support/tickets/${t.id}`} className="text-link hover:underline">
                      {t.ticketNo}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-foreground">
                    {t.subject}
                    {t.guestName && <span className="ml-2 text-xs text-foreground/50">for {t.guestName}</span>}
                  </td>
                  <td className="px-4 py-3 text-foreground/80">{t.category.categoryName}</td>
                  <td className="px-4 py-3 text-center text-xs text-foreground/70">{t.channel}</td>
                  {/* Centred, dd-Mmm-yyyy hh:mm — the DATETIME convention every table here follows. */}
                  <td className="whitespace-nowrap px-4 py-3 text-center text-foreground/80">
                    {formatDateTime(t.raisedAt)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <StatusPill status={t.mergedIntoTicketId !== null ? "MERGED" : t.status} />
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
