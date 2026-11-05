import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import {
  listMyTickets,
  listApplications,
  listSegments,
  myTicketsScope,
  oldestOpenTicketDate,
} from "@/lib/tickets";
import { formatDateTime } from "@/lib/report-format";
import { StatusPill } from "@/components/support/ticket-ui";
import TicketFilterRow, { type TicketColumnSpec } from "@/components/support/TicketFilterRow";
import TicketPager from "@/components/support/TicketPager";
import TicketDateRange from "@/components/support/TicketDateRange";
import { describeTicketType, TICKET_TYPES, TICKET_TYPE_LABELS } from "@/lib/ticket-core";
import { CHANNELS, channelLabel } from "@/lib/ticket-schemas";
import {
  parseTicketListParams,
  defaultCreatedRange,
  hasActiveFilters,
  toDateInputValue,
  STATUS_FILTERS,
} from "@/lib/ticket-list-core";

const DEFAULT_STATUS = "ANY_OPEN";


export default async function MyTicketsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const params = await searchParams;
  const filters = parseTicketListParams(params, { status: DEFAULT_STATUS });

  // The default range starts at the caller's oldest still-open ticket (capped at 90 days),
  // so the list opens showing everything outstanding rather than a window that might hide
  // it. Only looked up when the URL carries no dates of its own.
  const now = new Date();
  let { from, to } = filters;
  if (!from || !to) {
    const oldest = await oldestOpenTicketDate(myTicketsScope(session.userUid, session.username));
    const fallback = defaultCreatedRange(oldest, now);
    from = from ?? fallback.from;
    to = to ?? fallback.to;
  }

  const [{ rows, window }, applications, segments] = await Promise.all([
    listMyTickets(session.userUid, session.username, { ...filters, from, to }, now),
    listApplications(),
    listSegments(),
  ]);

  const columns: TicketColumnSpec[] = [
    { header: "Ticket", filter: { kind: "text", param: "ticketNo", placeholder: "TKT-…" } },
    { header: "Subject", filter: { kind: "text", param: "subject", placeholder: "Contains…" } },
    {
      header: "Type",
      filter: {
        kind: "select",
        param: "ticketType",
        options: [
          { value: "", label: "All" },
          ...TICKET_TYPES.map((t) => ({ value: t, label: TICKET_TYPE_LABELS[t] })),
        ],
      },
    },
    {
      header: "Application",
      filter: {
        kind: "select",
        param: "applicationId",
        options: [{ value: "", label: "All" }, ...applications.map((a) => ({ value: String(a.id), label: a.name }))],
      },
    },
    {
      header: "Segment",
      filter: {
        kind: "select",
        param: "segmentId",
        options: [{ value: "", label: "All" }, ...segments.map((s) => ({ value: String(s.id), label: s.name }))],
      },
    },
    {
      header: "Channel",
      align: "center",
      filter: {
        kind: "select",
        param: "channel",
        // Derived from CHANNELS rather than listed again here: a second copy is how the
        // filter ends up offering a channel the raise screen cannot produce, or missing one
        // it can.
        options: [
          { value: "", label: "All" },
          ...CHANNELS.map((c) => ({ value: c, label: channelLabel(c) })),
        ],
      },
    },
    { header: "Raised", align: "center", filter: { kind: "none" } },
    {
      header: "Status",
      align: "center",
      filter: {
        kind: "select",
        param: "status",
        // The page applies a default the URL does not carry, so the control is told what is
        // actually in force rather than inferring it from an absent param.
        value: filters.status,
        options: STATUS_FILTERS.map((s) => ({ value: s.value, label: s.label })),
      },
    },
  ];

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-4">
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

      <div className="mb-3">
        <TicketDateRange
          from={toDateInputValue(from)}
          to={toDateInputValue(to)}
          showClear={hasActiveFilters(filters, DEFAULT_STATUS) || filters.from !== null || filters.to !== null}
        />
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-surface text-left text-xs uppercase tracking-wide text-foreground/60">
            <tr>
              {columns.map((c) => (
                <th
                  key={c.header}
                  className={`px-4 py-3 font-semibold ${c.align === "center" ? "text-center" : ""}`}
                >
                  {c.header}
                </th>
              ))}
            </tr>
            <TicketFilterRow columns={columns} />
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-10 text-center text-sm text-foreground/70">
                  No tickets match these filters.
                </td>
              </tr>
            ) : (
              rows.map((t) => (
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
                  <td className="px-4 py-3 text-foreground/80">{describeTicketType(t.ticketType, t.typeOther)}</td>
                  <td className="px-4 py-3 text-foreground/80">{t.application.name}</td>
                  <td className="px-4 py-3 text-foreground/80">{t.segment.name}</td>
                  <td className="px-4 py-3 text-center text-xs text-foreground/70">{t.channel}</td>
                  {/* Centred, dd-Mmm-yyyy hh:mm — the DATETIME convention every table here follows. */}
                  <td className="whitespace-nowrap px-4 py-3 text-center text-foreground/80">
                    {formatDateTime(t.raisedAt)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <StatusPill status={t.mergedIntoTicketId !== null ? "MERGED" : t.status} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <TicketPager window={window} searchParams={params} basePath="/support/tickets" />
    </div>
  );
}
