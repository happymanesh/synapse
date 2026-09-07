import "server-only";
import { prisma } from "@/lib/db";
import {
  canDecideChangeRequest,
  canProposeChangeRequest,
  ticketStatusAfterDecision,
  timestampsForTransition,
} from "@/lib/ticket-core";

/**
 * Change-request conversion (BRS §4.6).
 *
 * Deliberately two-step. The desk *proposes*, Product/Ops *decides* — §4.6 is explicit that
 * the support desk cannot unilaterally park an item in the backlog, so approval can never be
 * a field set at creation time. That separation is enforced in the routes by two different
 * authority checks, not by the UI hiding a button.
 */

export interface Actor {
  uid: number;
  username: string;
}

/**
 * Puts a ticket forward as a change request and parks the ticket pending a decision.
 *
 * The ticket is NOT closed here. §4.6 closes it only on approval, so a rejected proposal
 * leaves a still-open ticket the desk has to deal with rather than a quietly buried one.
 */
export async function proposeChangeRequest(
  ticketId: number,
  input: { title: string; description: string },
  actor: Actor
) {
  return prisma.$transaction(async (tx) => {
    const ticket = await tx.ticket.findUnique({
      where: { id: ticketId },
      select: { id: true, ticketNo: true, status: true, mergedIntoTicketId: true, changeRequest: { select: { id: true } } },
    });
    if (!ticket) throw new Error("Ticket not found.");

    if (!canProposeChangeRequest({
      status: ticket.status,
      mergedIntoTicketId: ticket.mergedIntoTicketId,
      hasChangeRequest: ticket.changeRequest !== null,
    })) {
      throw new Error(
        ticket.changeRequest !== null
          ? "This ticket already has a change request."
          : ticket.mergedIntoTicketId !== null
            ? "This ticket has been merged — raise the change request on the surviving thread."
            : `A ${ticket.status.replace(/_/g, " ").toLowerCase()} ticket cannot be converted.`
      );
    }

    const cr = await tx.changeRequest.create({
      data: {
        ticketId,
        title: input.title,
        description: input.description,
        requestedByUid: actor.uid,
        approvalStatus: "PENDING",
        createdBy: actor.username,
      },
      select: { id: true, crNo: true },
    });

    await tx.ticket.update({
      where: { id: ticketId },
      data: { status: "AWAITING_CR_APPROVAL", updatedBy: actor.username },
    });

    await tx.ticketEvent.create({
      data: {
        ticketId,
        eventType: "CR_PROPOSED",
        fromStatus: ticket.status,
        toStatus: "AWAITING_CR_APPROVAL",
        remarks: `Proposed as change request ${cr.crNo}: ${input.title}. Awaiting Product/Ops approval.`,
        actorUid: actor.uid,
        actorUsername: actor.username,
      },
    });

    return cr;
  });
}

/**
 * Product/Ops decides. Approval closes the originating ticket and parks the item in the
 * backlog; rejection hands the ticket back to the desk.
 *
 * The user-facing notification is queued only on approval — §4.6's "considered for a future
 * release" is a statement about work that was actually accepted, and telling someone their
 * issue is closed when it was rejected would be simply untrue.
 */
export async function decideChangeRequest(
  crId: number,
  input: { decision: "APPROVED" | "REJECTED"; remarks: string | null; targetRelease: string | null },
  actor: Actor
) {
  return prisma.$transaction(async (tx) => {
    const cr = await tx.changeRequest.findUnique({
      where: { id: crId },
      select: {
        id: true,
        crNo: true,
        title: true,
        approvalStatus: true,
        ticketId: true,
        ticket: {
          select: {
            id: true,
            ticketNo: true,
            status: true,
            resolvedAt: true,
            closedAt: true,
            raiserUid: true,
            guestEmail: true,
            guestMobile: true,
          },
        },
      },
    });
    if (!cr) throw new Error("Change request not found.");
    if (!canDecideChangeRequest(cr)) {
      throw new Error(`This change request was already ${cr.approvalStatus.toLowerCase()}.`);
    }

    const now = new Date();
    const toStatus = ticketStatusAfterDecision(input.decision);
    const stamps = timestampsForTransition(toStatus, now, {
      resolvedAt: cr.ticket.resolvedAt,
      closedAt: cr.ticket.closedAt,
    });

    await tx.changeRequest.update({
      where: { id: crId },
      data: {
        approvalStatus: input.decision,
        approvedByUid: actor.uid,
        approvedAt: now,
        approvalRemarks: input.remarks,
        // Only an approved item belongs in the backlog at all.
        backlogStatus: input.decision === "APPROVED" ? "BACKLOG" : null,
        targetRelease: input.decision === "APPROVED" ? input.targetRelease : null,
        updatedBy: actor.username,
      },
    });

    await tx.ticket.update({
      where: { id: cr.ticketId },
      data: {
        status: toStatus,
        resolvedAt: stamps.resolvedAt,
        closedAt: stamps.closedAt,
        updatedBy: actor.username,
      },
    });

    await tx.ticketEvent.create({
      data: {
        ticketId: cr.ticketId,
        eventType: input.decision === "APPROVED" ? "CR_APPROVED" : "CR_REJECTED",
        fromStatus: cr.ticket.status,
        toStatus,
        remarks:
          input.decision === "APPROVED"
            ? `${cr.crNo} approved by Product/Ops and parked in the backlog${input.targetRelease ? ` for ${input.targetRelease}` : ""}. Ticket closed.${input.remarks ? ` ${input.remarks}` : ""}`
            : `${cr.crNo} rejected by Product/Ops; returned to the support desk.${input.remarks ? ` ${input.remarks}` : ""}`,
        actorUid: actor.uid,
        actorUsername: actor.username,
      },
    });

    if (input.decision === "APPROVED") {
      const raiser = cr.ticket.raiserUid
        ? await tx.userDetails.findUnique({ where: { uid: cr.ticket.raiserUid }, select: { email: true, mobile: true } })
        : null;
      const email = raiser?.email ?? cr.ticket.guestEmail;
      const mobile = raiser?.mobile ?? cr.ticket.guestMobile;
      const channel = email ? "EMAIL" : mobile ? "SMS" : null;

      // Queued, not sent — Synapse still has no delivery provider. A raiser with no contact
      // simply gets no message; that must never block the decision.
      if (channel) {
        await tx.channelMessage.create({
          data: {
            direction: "OUTBOUND",
            channel,
            purpose: "CR_CLOSURE",
            ticketId: cr.ticketId,
            counterparty: (channel === "EMAIL" ? email : mobile)!,
            subject: `Update on ${cr.ticket.ticketNo}`,
            body:
              `Thank you for raising ${cr.ticket.ticketNo}.\n\n` +
              `We've reviewed "${cr.title}" and it is being considered for a future release. ` +
              `This ticket is now closed, and the change is tracked as ${cr.crNo}.`,
            status: "QUEUED",
          },
        });
      }
    }

    return { crNo: cr.crNo, ticketNo: cr.ticket.ticketNo, decision: input.decision, ticketStatus: toStatus };
  });
}

/** Updates where an approved item sits in the backlog. */
export async function updateBacklogStatus(
  crId: number,
  input: { backlogStatus: string; targetRelease: string | null },
  actor: Actor
) {
  const cr = await prisma.changeRequest.findUnique({
    where: { id: crId },
    select: { approvalStatus: true, ticketId: true, crNo: true },
  });
  if (!cr) throw new Error("Change request not found.");
  if (cr.approvalStatus !== "APPROVED") {
    throw new Error("Only an approved change request has a backlog position.");
  }

  await prisma.changeRequest.update({
    where: { id: crId },
    data: { backlogStatus: input.backlogStatus, targetRelease: input.targetRelease, updatedBy: actor.username },
  });

  // Logged against the originating ticket, so the ticket's history stays the single place
  // anyone can read to find out what became of the issue.
  await prisma.ticketEvent.create({
    data: {
      ticketId: cr.ticketId,
      eventType: "REMARK",
      remarks: `${cr.crNo} backlog status set to ${input.backlogStatus.replace(/_/g, " ").toLowerCase()}${input.targetRelease ? ` (${input.targetRelease})` : ""}.`,
      actorUid: actor.uid,
      actorUsername: actor.username,
    },
  });

  return { ok: true };
}

export async function listChangeRequests() {
  return prisma.changeRequest.findMany({
    orderBy: [{ approvalStatus: "asc" }, { requestedAt: "desc" }],
    take: 200,
    select: {
      id: true,
      crNo: true,
      title: true,
      description: true,
      approvalStatus: true,
      backlogStatus: true,
      targetRelease: true,
      requestedAt: true,
      approvedAt: true,
      approvalRemarks: true,
      requestedBy: { select: { fullName: true } },
      approvedBy: { select: { fullName: true } },
      ticket: { select: { id: true, ticketNo: true, subject: true, status: true } },
    },
  });
}
