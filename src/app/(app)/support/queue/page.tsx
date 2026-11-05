import Link from "next/link";
import { requireMenu } from "@/lib/auth";
import { listTriageQueue, listApplications, listSegments, triageCounts } from "@/lib/tickets";
import { SUPPORT_MENU } from "@/lib/support-schemas";
import {
  hasBreachedResponseTarget,
  RESPONSE_TARGET_HOURS,
  describeTicketType,
  TICKET_TYPES,
  TICKET_TYPE_LABELS,
} from "@/lib/ticket-core";
import { StatusPill, AgeCell } from "@/components/support/ticket-ui";
import TicketFilterRow, { type TicketColumnSpec } from "@/components/support/TicketFilterRow";
import TicketPager from "@/components/support/TicketPager";
import TicketDateRange from "@/components/support/TicketDateRange";
import {
  parseTicketListParams,
  hasActiveFilters,
  toDateInputValue,
  STATUS_FILTERS,
  CLOSED_WINDOW_DAYS,
} from "@/lib/ticket-list-core";

const DEFAULT_STATUS = "ANY_OPEN";

const STATUS_LABELS: Record<string, string> = {
  OPEN: "Open",
  IN_PROGRESS: "In progress",
  FORWARDED: "Forwarded",
  AWAITING_CR_APPROVAL: "Awaiting CR",
};

export default async function TriageQueuePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireMenu(SUPPORT_MENU.QUEUE);
  const params = await searchParams;
  const filters = parseTicketListParams(params, { status: DEFAULT_STATUS });
  const now = new Date();

  const [{ rows, window }, counts, applications, segments] = await Promise.all([
    listTriageQueue(filters, now),
    triageCounts(now),
    listApplications(),
    listSegments(),
  ]);

  const columns: TicketColumnSpec[] = [
    { header: "Ticket", filter: { kind: "text", param: "ticketNo", placeholder: "TKT-…" } },
    { header: "Subject", filter: { kind: "text", param: "subject", placeholder: "Contains…" } },
    { header: "Raised by", filter: { kind: "text", param: "raisedBy", placeholder: "Name…" } },
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
    { header: "Assigned", filter: { kind: "text", param: "assignedTo", placeholder: "Name…" } },
    { header: "Waiting", align: "center", filter: { kind: "none" } },
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

  // Each box is a link to this same page with the status pre-selected — the drilldown is
  // the filter, so there is only ever one mechanism deciding what the table shows.
  const boxes = [
    { label: "All open", value: "ANY_OPEN", count: counts.anyOpen },
    ...counts.byStatus.map((s) => ({
      label: STATUS_LABELS[s.status] ?? s.status,
      value: s.status,
      count: s.count,
    })),
    { label: `Closed in last ${CLOSED_WINDOW_DAYS} days`, value: "CLOSED_RECENT", count: counts.closedRecent },
  ];

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-xl font-semibold text-foreground">Triage Queue</h1>
        <p className="text-sm text-foreground/60">
          Longest-waiting first. Response target is a flat {RESPONSE_TARGET_HOURS} hours.
        </p>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {boxes.map((b) => {
          const active = filters.status === b.value;
          return (
            <Link
              key={b.value}
              href={`/support/queue?status=${b.value}`}
              className={`rounded-lg border p-3 shadow-sm transition-colors ${
                active ? "border-brand-navy bg-surface" : "border-border bg-card hover:bg-surface/60"
              }`}
            >
              <div className="text-2xl font-semibold text-foreground">{b.count}</div>
              <div className="text-xs text-foreground/60">{b.label}</div>
            </Link>
          );
        })}
      </div>

      <div className="mb-3">
        <TicketDateRange
          from={filters.from ? toDateInputValue(filters.from) : ""}
          to={filters.to ? toDateInputValue(filters.to) : ""}
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
                  Nothing matches these filters.
                </td>
              </tr>
            ) : (
              rows.map((t) => {
                const breached = hasBreachedResponseTarget(
                  {
                    slaClockStartAt: t.slaClockStartAt,
                    firstResponseAt: t.firstResponseAt,
                    status: t.status,
                    mergedIntoTicketId: t.mergedIntoTicketId,
                  },
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
                    <td className="px-4 py-3 text-foreground/80">{describeTicketType(t.ticketType, t.typeOther)}</td>
                    <td className="px-4 py-3 text-foreground/80">{t.application.name}</td>
                    <td className="px-4 py-3 text-foreground/80">{t.segment.name}</td>
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
              })
            )}
          </tbody>
        </table>
      </div>

      <TicketPager window={window} searchParams={params} basePath="/support/queue" />

      <p className="mt-3 text-xs text-foreground/50">Signed in as {session.username}.</p>
    </div>
  );
}
