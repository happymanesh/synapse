import Link from "next/link";
import { requireMenu } from "@/lib/auth";
import { listTriageQueue } from "@/lib/tickets";
import { SUPPORT_MENU } from "@/lib/support-schemas";
import { hasBreachedResponseTarget, RESPONSE_TARGET_HOURS } from "@/lib/ticket-core";
import { StatusPill, AgeCell } from "@/components/support/ticket-ui";

export default async function TriageQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const session = await requireMenu(SUPPORT_MENU.QUEUE);
  const { status } = await searchParams;

  const tickets = await listTriageQueue({ status });
  const now = new Date();

  // §4.5's daily reminder, resolved at read time rather than pushed by a cron — the same
  // reasoning as notification scheduling and menu-usage retention. A background job would
  // buy nothing here: this list is correct whenever it is looked at.
  const overdue = tickets.filter((t) =>
    hasBreachedResponseTarget(
      { slaClockStartAt: t.slaClockStartAt, firstResponseAt: t.firstResponseAt, status: t.status, mergedIntoTicketId: t.mergedIntoTicketId },
      now
    )
  );
  const unanswered = tickets.filter((t) => t.firstResponseAt === null);

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-xl font-semibold text-foreground">Triage Queue</h1>
        <p className="text-sm text-foreground/60">
          Every open ticket, longest-waiting first. Response target is a flat {RESPONSE_TARGET_HOURS} hours.
        </p>
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Stat label="Open tickets" value={tickets.length} />
        <Stat label="Awaiting first response" value={unanswered.length} />
        <Stat label="Past response target" value={overdue.length} tone={overdue.length > 0 ? "danger" : undefined} />
      </div>

      {tickets.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-10 text-center text-sm text-foreground/70">
          Nothing open. The queue is clear.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-surface text-left text-xs uppercase tracking-wide text-foreground/60">
              <tr>
                <th className="px-4 py-3 font-semibold">Ticket</th>
                <th className="px-4 py-3 font-semibold">Subject</th>
                <th className="px-4 py-3 font-semibold">Raised by</th>
                <th className="px-4 py-3 font-semibold">Category</th>
                <th className="px-4 py-3 font-semibold">Assigned</th>
                <th className="px-4 py-3 text-center font-semibold">Waiting</th>
                <th className="px-4 py-3 text-center font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => {
                const breached = hasBreachedResponseTarget(
                  { slaClockStartAt: t.slaClockStartAt, firstResponseAt: t.firstResponseAt, status: t.status, mergedIntoTicketId: t.mergedIntoTicketId },
                  now
                );
                return (
                  <tr key={t.id} className="border-b border-border last:border-0 hover:bg-surface/60">
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs font-semibold">
                      <Link href={`/support/tickets/${t.id}`} className="text-link hover:underline">
                        {t.ticketNo}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-foreground">{t.subject}</td>
                    <td className="px-4 py-3 text-foreground/80">
                      {t.raiser?.fullName ?? t.guestName ?? <span className="text-foreground/50">Guest</span>}
                    </td>
                    <td className="px-4 py-3 text-foreground/80">{t.category.categoryName}</td>
                    <td className="px-4 py-3 text-foreground/80">
                      {t.assignedTo?.fullName ?? <span className="text-foreground/50">Unassigned</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-center">
                      <AgeCell since={t.slaClockStartAt} now={now} breached={breached} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <StatusPill status={t.status} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-xs text-foreground/50">Signed in as {session.username}.</p>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "danger" }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className={`text-2xl font-semibold ${tone === "danger" ? "text-danger" : "text-foreground"}`}>{value}</div>
      <div className="text-xs text-foreground/60">{label}</div>
    </div>
  );
}
