/**
 * Pure rules for the start-of-day digest: who gets one, and what is in it.
 *
 * Free of `server-only` and of any Prisma import so the rules are unit tested directly
 * (tests/bod-digest-core.test.ts). `@/lib/bod-digest` is the DB-and-mail layer.
 *
 * The digest exists because the Triage Queue only tells you something when you go and look
 * at it. §4.5's "daily reminder" was deliberately built as read-time counters to avoid
 * needing a scheduler; this is the push half, and it is the first thing in Synapse that
 * runs without somebody opening a page.
 */

import { hasBreachedResponseTarget, OPEN_STATUSES } from "./ticket-core";

export interface DigestTicket {
  id: number;
  ticketNo: string;
  subject: string;
  status: string;
  ticketType: string;
  typeOther: string | null;
  applicationName: string;
  segmentName: string;
  raisedAt: Date;
  slaClockStartAt: Date;
  firstResponseAt: Date | null;
  revisedEta: Date | null;
  mergedIntoTicketId: number | null;
  assignedToUid: number | null;
}

export interface DigestRecipient {
  uid: number;
  username: string;
  fullName: string;
  email: string | null;
}

export interface DigestGroup {
  recipient: DigestRecipient;
  /** Longest-waiting first — the digest's whole purpose is surfacing what has been sitting. */
  tickets: DigestTicket[];
  overdueCount: number;
  unansweredCount: number;
}

/** Whether a ticket belongs in anyone's morning list. */
export function isDigestable(ticket: DigestTicket): boolean {
  // An absorbed ticket's work lives on the surviving thread now; listing both would have two
  // people chasing one problem.
  if (ticket.mergedIntoTicketId !== null) return false;
  if (!(OPEN_STATUSES as readonly string[]).includes(ticket.status)) return false;
  return ticket.assignedToUid !== null;
}

export function isOverdue(ticket: DigestTicket, now: Date): boolean {
  return hasBreachedResponseTarget(
    {
      slaClockStartAt: ticket.slaClockStartAt,
      firstResponseAt: ticket.firstResponseAt,
      status: ticket.status,
      mergedIntoTicketId: ticket.mergedIntoTicketId,
    },
    now
  );
}

/**
 * Tickets to per-assignee groups.
 *
 * Anyone with nothing open is left out entirely rather than sent an empty digest. A daily
 * mail saying "you have 0 tickets" trains people to filter the whole thread, and then the
 * morning it says 9 goes unread with the rest.
 *
 * Recipients are matched from the supplied list; a ticket assigned to somebody absent from
 * it (deactivated, say) is dropped rather than silently reassigned to anyone.
 */
export function groupForDigest(
  tickets: DigestTicket[],
  recipients: DigestRecipient[],
  now: Date
): DigestGroup[] {
  const byUid = new Map(recipients.map((r) => [r.uid, r]));
  const groups = new Map<number, DigestGroup>();

  for (const ticket of tickets) {
    if (!isDigestable(ticket)) continue;
    const recipient = byUid.get(ticket.assignedToUid as number);
    if (!recipient) continue;

    let group = groups.get(recipient.uid);
    if (!group) {
      group = { recipient, tickets: [], overdueCount: 0, unansweredCount: 0 };
      groups.set(recipient.uid, group);
    }
    group.tickets.push(ticket);
    if (isOverdue(ticket, now)) group.overdueCount++;
    if (ticket.firstResponseAt === null) group.unansweredCount++;
  }

  for (const group of groups.values()) {
    group.tickets.sort((a, b) => a.slaClockStartAt.getTime() - b.slaClockStartAt.getTime());
  }

  // Busiest desks first, so a run that is interrupted part-way has still reached the people
  // with the most waiting on them.
  return [...groups.values()].sort((a, b) => b.tickets.length - a.tickets.length);
}

/**
 * The marker that makes a run repeatable without mailing anyone twice.
 *
 * Keyed on the calendar day and the recipient, not on a run id: a scheduler that fires
 * twice, a retry after a timeout, and two app instances starting together must all converge
 * on "this person has had today's digest".
 */
export function digestKey(day: Date, recipientUid: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
  return `BOD:${date}:${recipientUid}`;
}

/** Whole hours a ticket has been waiting, for the digest's age column. */
export function waitingHours(ticket: DigestTicket, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - ticket.slaClockStartAt.getTime()) / 3_600_000));
}
