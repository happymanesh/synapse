import "server-only";
import { prisma } from "@/lib/db";
import { getMailer, mailConfig } from "@/lib/mail/mailer";
import { bodDigestEmail, type DigestRow } from "@/lib/mail/bod-digest.template";
import { describeTicketType, OPEN_STATUSES, RESPONSE_TARGET_HOURS } from "@/lib/ticket-core";
import {
  groupForDigest,
  digestKey,
  isOverdue,
  waitingHours,
  type DigestRecipient,
  type DigestTicket,
} from "@/lib/bod-digest-core";

/**
 * The start-of-day digest: one email per assignee listing the tickets open with them.
 *
 * Triggered from outside — see `/api/jobs/bod-digest` and `npm run job:bod-digest`. The
 * trigger is deliberately not decided here, because the production deployment is in-house
 * and may use Windows Task Scheduler, cron, or a Railway cron service. All three can call
 * the same entry points, so the choice stays open and changing it touches nothing in here.
 */

export interface DigestRunResult {
  /** People who had at least one open ticket. */
  candidates: number;
  sent: number;
  failed: number;
  /** Already had today's digest — a second run is a no-op for them. */
  skipped: number;
  /** Had tickets but no email address on file. */
  noEmail: number;
  details: { username: string; outcome: "SENT" | "FAILED" | "SKIPPED" | "NO_EMAIL"; reason?: string }[];
}

/**
 * Runs the digest for one day.
 *
 * `dryRun` renders and reports without sending or recording anything, so the job can be
 * proved against real data before it is allowed to mail anybody.
 */
export async function sendBodDigest(
  options: { now?: Date; dryRun?: boolean } = {}
): Promise<DigestRunResult> {
  const now = options.now ?? new Date();
  const dryRun = options.dryRun ?? false;
  const config = mailConfig();
  const appUrl = config.appUrl.replace(/\/+$/, "");

  const rows = await prisma.ticket.findMany({
    where: {
      mergedIntoTicketId: null,
      status: { in: [...OPEN_STATUSES] },
      assignedToUid: { not: null },
    },
    select: {
      id: true,
      ticketNo: true,
      subject: true,
      status: true,
      ticketType: true,
      typeOther: true,
      raisedAt: true,
      slaClockStartAt: true,
      firstResponseAt: true,
      revisedEta: true,
      mergedIntoTicketId: true,
      assignedToUid: true,
      application: { select: { name: true } },
      segment: { select: { name: true } },
    },
  });

  const tickets: DigestTicket[] = rows.map((t) => ({
    id: t.id,
    ticketNo: t.ticketNo,
    subject: t.subject,
    status: t.status,
    ticketType: t.ticketType,
    typeOther: t.typeOther,
    applicationName: t.application.name,
    segmentName: t.segment.name,
    raisedAt: t.raisedAt,
    slaClockStartAt: t.slaClockStartAt,
    firstResponseAt: t.firstResponseAt,
    revisedEta: t.revisedEta,
    mergedIntoTicketId: t.mergedIntoTicketId,
    assignedToUid: t.assignedToUid,
  }));

  // Only active users: someone deactivated overnight should not be mailed their old queue.
  const assigneeUids = [...new Set(tickets.map((t) => t.assignedToUid).filter((u): u is number => u !== null))];
  const users = await prisma.userDetails.findMany({
    where: { uid: { in: assigneeUids }, isActive: true },
    select: { uid: true, username: true, fullName: true, email: true },
  });
  const recipients: DigestRecipient[] = users;

  const groups = groupForDigest(tickets, recipients, now);
  const result: DigestRunResult = {
    candidates: groups.length,
    sent: 0,
    failed: 0,
    skipped: 0,
    noEmail: 0,
    details: [],
  };

  for (const group of groups) {
    const key = digestKey(now, group.recipient.uid);

    // The idempotency gate. A scheduler that retries after a timeout, a double-fired cron,
    // or two app instances starting together must all converge on one email per person per
    // day — so the check is a stored marker, not a flag in memory.
    const already = await prisma.channelMessage.findFirst({
      where: { purpose: "BOD_DIGEST", counterparty: key },
      select: { id: true },
    });
    if (already) {
      result.skipped++;
      result.details.push({ username: group.recipient.username, outcome: "SKIPPED" });
      continue;
    }

    if (!group.recipient.email) {
      result.noEmail++;
      result.details.push({ username: group.recipient.username, outcome: "NO_EMAIL" });
      continue;
    }

    const digestRows: DigestRow[] = group.tickets.map((t) => ({
      ticketNo: t.ticketNo,
      subject: t.subject,
      ticketType: describeTicketType(t.ticketType, t.typeOther),
      application: t.applicationName,
      raisedAt: t.raisedAt,
      waitingHours: waitingHours(t, now),
      overdue: isOverdue(t, now),
      url: `${appUrl}/support/tickets/${t.id}`,
    }));

    const rendered = bodDigestEmail({
      recipientName: group.recipient.fullName.split(" ")[0] || group.recipient.fullName,
      rows: digestRows,
      overdueCount: group.overdueCount,
      unansweredCount: group.unansweredCount,
      queueUrl: `${appUrl}/support/queue`,
      when: now,
      responseTargetHours: RESPONSE_TARGET_HOURS,
      productName: config.fromName,
    });

    if (dryRun) {
      result.details.push({
        username: group.recipient.username,
        outcome: "SENT",
        reason: `dry run — ${digestRows.length} tickets, ${group.overdueCount} overdue`,
      });
      result.sent++;
      continue;
    }

    const sent = await getMailer(config).send({ to: group.recipient.email, ...rendered });

    // Recorded whether or not it was accepted. Writing the marker only on success would
    // mean a provider outage re-mails everyone who did succeed when the job is run again.
    //
    // The cost, stated plainly: a FAILED digest is not retried either. Today's marker
    // exists, so a later run skips that person. That is the right default for a daily
    // summary — silently mailing someone twice is worse than their missing one morning —
    // but it means a resend is a manual act: delete the BOD_DIGEST row carrying that key
    // and run the job again.
    await prisma.channelMessage.create({
      data: {
        direction: "OUTBOUND",
        channel: "EMAIL",
        purpose: "BOD_DIGEST",
        counterparty: key,
        subject: rendered.subject,
        body: rendered.text,
        providerMessageId: sent.providerMessageId,
        status: sent.accepted ? "SENT" : "FAILED",
        sentAt: sent.accepted ? new Date() : null,
        failureReason: sent.failureReason,
        attempts: 1,
      },
    });

    if (sent.accepted) {
      result.sent++;
      result.details.push({ username: group.recipient.username, outcome: "SENT" });
    } else {
      result.failed++;
      result.details.push({
        username: group.recipient.username,
        outcome: "FAILED",
        reason: sent.failureReason ?? "unknown error",
      });
    }
  }

  console.info(
    `[bod-digest] ${result.candidates} candidates, ${result.sent} sent, ${result.failed} failed, ` +
      `${result.skipped} already sent, ${result.noEmail} without an address`
  );
  return result;
}
