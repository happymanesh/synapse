import "server-only";
import { prisma } from "@/lib/db";
import { hasMenuAccess } from "@/lib/auth";
import { SUPPORT_MENU } from "@/lib/support-schemas";
import {
  resolveRaiser,
  raiserTypeForHierarchy,
  normalizeEmail,
  normalizeMobile,
  findDuplicateCandidates,
  mergedClockStart,
  canReconcile,
  canTransition,
  timestampsForTransition,
  DUPLICATE_WINDOW_HOURS,
  OPEN_STATUSES,
  type MasterUserRow,
  type ResolvedRaiser,
  type TicketLike,
} from "@/lib/ticket-core";

/**
 * DB-backed layer around the pure rules in `@/lib/ticket-core`. Every intake channel
 * (§4.1 — Website, WhatsApp, Phone, Synapse) goes through `createTicket`, so the WhatsApp
 * adapter at step 9 becomes a caller rather than a second implementation.
 */

/** Holding the triage-queue menu is what makes someone support staff. Access stays derived
 * from role -> menu (REBUILD §4.1); there is deliberately no separate permission table. */
export async function canLogForOthers(userUid: number): Promise<boolean> {
  return hasMenuAccess(userUid, SUPPORT_MENU.QUEUE);
}

/**
 * Narrows master data to plausible matches; `resolveRaiser` then decides.
 *
 * The split matters: SQL only shortlists (exact email, or a mobile ending in the same 10
 * digits, which is how an E.164 WhatsApp number matches a locally-stored one), while the
 * actual attribution rule — including the refusal to guess between two matches — stays in
 * the tested pure module rather than being re-expressed in a query.
 */
async function findIdentityCandidates(email: string | null, mobile: string | null): Promise<MasterUserRow[]> {
  const or = [];
  if (email) or.push({ email: { equals: email, mode: "insensitive" as const } });
  if (mobile) or.push({ mobile: { endsWith: mobile } });
  if (or.length === 0) return [];

  return prisma.userDetails.findMany({
    where: { OR: or },
    select: { uid: true, hierarchyCode: true, email: true, mobile: true, isActive: true },
  });
}

export type TicketRaiser =
  | { kind: "SELF"; uid: number; hierarchyCode: string }
  | {
      kind: "CONTACT";
      name: string | null;
      email: string | null;
      mobile: string | null;
      clientCode: string | null;
    };

export interface CreateTicketArgs {
  channel: string;
  categoryCode: string;
  subject: string;
  description: string;
  companyCode: string;
  /** Username of whoever physically entered this — the session user, even when logging for
   * someone else. Distinct from the raiser, who is the person the issue belongs to. */
  createdByUsername: string;
  actorUid: number | null;
  raiser: TicketRaiser;
  /** Lets a staff member log a call that came in earlier. Defaults to now. */
  raisedAt?: Date;
}

export interface CreateTicketResult {
  id: number;
  ticketNo: string;
  raiserUid: number | null;
  raiserType: string;
  /** True when the contact matched several people and we refused to guess (§4.2). */
  ambiguous: boolean;
  /** False when there was no contact to notify — the ticket is still created (§5). */
  notificationQueued: boolean;
}

export async function createTicket(args: CreateTicketArgs): Promise<CreateTicketResult> {
  const raisedAt = args.raisedAt ?? new Date();

  let resolved: ResolvedRaiser;
  let guestName: string | null = null;
  let guestEmail: string | null = null;
  let guestMobile: string | null = null;
  let clientCode: string | null = null;
  let notifyEmail: string | null = null;
  let notifyMobile: string | null = null;

  if (args.raiser.kind === "SELF") {
    resolved = {
      raiserUid: args.raiser.uid,
      raiserType: raiserTypeForHierarchy(args.raiser.hierarchyCode),
      matchedOn: null,
      ambiguous: false,
    };
    const me = await prisma.userDetails.findUnique({
      where: { uid: args.raiser.uid },
      select: { email: true, mobile: true },
    });
    notifyEmail = normalizeEmail(me?.email);
    notifyMobile = normalizeMobile(me?.mobile);
  } else {
    const email = normalizeEmail(args.raiser.email);
    const mobile = normalizeMobile(args.raiser.mobile);
    resolved = resolveRaiser({ email, mobile }, await findIdentityCandidates(email, mobile));
    clientCode = args.raiser.clientCode;

    if (resolved.raiserUid === null) {
      // Guest ticket: keep exactly what was captured (§4.2). These columns are never
      // cleared later, so a reconciled ticket still shows what intake actually had.
      guestName = args.raiser.name;
      guestEmail = args.raiser.email;
      guestMobile = args.raiser.mobile;
      notifyEmail = email;
      notifyMobile = mobile;
    } else {
      // Matched: the user record is the source of truth, so guest columns stay null and the
      // raw input is preserved in the CREATED event instead of duplicated here.
      const matched = await prisma.userDetails.findUnique({
        where: { uid: resolved.raiserUid },
        select: { email: true, mobile: true },
      });
      notifyEmail = normalizeEmail(matched?.email);
      notifyMobile = normalizeMobile(matched?.mobile);
    }
  }

  // A ticket must never exist without its CREATED event — the audit trail (§5) would start
  // with a gap — so both are written together.
  return prisma.$transaction(async (tx) => {
    const ticket = await tx.ticket.create({
      data: {
        raiserUid: resolved.raiserUid,
        raiserType: resolved.raiserType,
        guestName,
        guestEmail,
        guestMobile,
        clientCode,
        channel: args.channel,
        categoryCode: args.categoryCode,
        subject: args.subject,
        description: args.description,
        companyCode: args.companyCode,
        status: "OPEN",
        raisedAt,
        // No DB default: a back-dated phone ticket must start its clock when the client
        // actually called, not now.
        slaClockStartAt: raisedAt,
        createdBy: args.createdByUsername,
      },
      select: { id: true, ticketNo: true },
    });

    await tx.ticketEvent.create({
      data: {
        ticketId: ticket.id,
        eventType: "CREATED",
        toStatus: "OPEN",
        remarks: describeIdentityResolution(args.raiser, resolved),
        actorUid: args.actorUid,
        actorUsername: args.createdByUsername,
      },
    });

    // §4.2 registration notification. Queued only — Synapse has no delivery infrastructure
    // yet, so nothing transmits until a provider is wired behind sendMessage(). A raiser
    // with no contact simply gets no message; that must never block the ticket (§5).
    const channel = notifyEmail ? "EMAIL" : notifyMobile ? "SMS" : null;
    if (channel) {
      await tx.channelMessage.create({
        data: {
          direction: "OUTBOUND",
          channel,
          purpose: "TICKET_REGISTERED",
          ticketId: ticket.id,
          counterparty: (channel === "EMAIL" ? notifyEmail : notifyMobile)!,
          subject: `We've logged your request — ${ticket.ticketNo}`,
          body:
            `Your request has been registered as ${ticket.ticketNo} and is being looked into.\n\n` +
            `Subject: ${args.subject}\n\n` +
            `You'll hear from us within 24 hours.`,
          status: "QUEUED",
        },
      });
    }

    return {
      id: ticket.id,
      ticketNo: ticket.ticketNo,
      raiserUid: resolved.raiserUid,
      raiserType: resolved.raiserType,
      ambiguous: resolved.ambiguous,
      notificationQueued: channel !== null,
    };
  });
}

/**
 * The CREATED event's remark. Records *how* identity was decided, which the columns alone
 * cannot show — in particular it is what distinguishes "we don't know this person" from
 * "their contact matched two people and we refused to guess", two situations needing very
 * different follow-up.
 */
function describeIdentityResolution(raiser: TicketRaiser, resolved: ResolvedRaiser): string {
  if (raiser.kind === "SELF") return "Raised in Synapse by the signed-in user.";
  const captured = [raiser.name, raiser.email, raiser.mobile].filter(Boolean).join(", ") || "no contact details";
  if (resolved.ambiguous) {
    return `Logged for ${captured}. Contact matched more than one master record, so it was left as a guest ticket — reconcile manually.`;
  }
  if (resolved.raiserUid === null) {
    return `Logged for ${captured}. No master-data match — guest ticket.`;
  }
  return `Logged for ${captured}. Matched to an existing ${resolved.raiserType.toLowerCase()} record by ${resolved.matchedOn?.toLowerCase()}.`;
}

/**
 * Tickets the signed-in user may see on "My Tickets".
 *
 * Scoped to their own records per the CLAUDE.md ownership rule: tickets they raised, plus
 * tickets they logged for someone else (otherwise a staff member loses sight of a call they
 * just took). Seeing everyone's tickets is the triage queue, which is a separate menu gated
 * by role — not this list.
 */
export async function listMyTickets(userUid: number, username: string) {
  return prisma.ticket.findMany({
    where: { OR: [{ raiserUid: userUid }, { createdBy: username }] },
    orderBy: { raisedAt: "desc" },
    take: 100,
    select: {
      id: true,
      ticketNo: true,
      subject: true,
      status: true,
      channel: true,
      raisedAt: true,
      raiserType: true,
      guestName: true,
      mergedIntoTicketId: true,
      category: { select: { categoryName: true } },
    },
  });
}

/** Columns every ticket-detail consumer needs. Kept in one place so the queue, the detail
 * view and the duplicate probe cannot drift into selecting different shapes. */
const TICKET_DETAIL_SELECT = {
  id: true,
  ticketNo: true,
  subject: true,
  description: true,
  status: true,
  channel: true,
  raiserType: true,
  raiserUid: true,
  guestName: true,
  guestEmail: true,
  guestMobile: true,
  clientCode: true,
  categoryCode: true,
  companyCode: true,
  assignedToUid: true,
  revisedEta: true,
  raisedAt: true,
  slaClockStartAt: true,
  firstResponseAt: true,
  resolvedAt: true,
  closedAt: true,
  mergedIntoTicketId: true,
  mergedAt: true,
  createdBy: true,
} as const;

/**
 * A ticket the viewer is allowed to see, or null.
 *
 * Support staff see everything (the elevated-visibility right the CLAUDE.md ownership rule
 * allows for); everyone else sees only tickets they raised or logged. Returning null rather
 * than throwing lets the caller render a 404, so a probe cannot distinguish "no such ticket"
 * from "someone else's ticket".
 */
export async function getTicketForViewer(id: number, userUid: number, username: string) {
  const ticket = await prisma.ticket.findUnique({
    where: { id },
    select: {
      ...TICKET_DETAIL_SELECT,
      category: { select: { categoryName: true, productModule: true, issueType: true } },
      raiser: { select: { uid: true, fullName: true, username: true, email: true, mobile: true } },
      assignedTo: { select: { uid: true, fullName: true, username: true } },
      mergedInto: { select: { id: true, ticketNo: true } },
      mergedTickets: { select: { id: true, ticketNo: true, subject: true, raisedAt: true } },
      changeRequest: {
        select: { id: true, crNo: true, title: true, approvalStatus: true, backlogStatus: true, targetRelease: true },
      },
      events: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!ticket) return null;

  const staff = await canLogForOthers(userUid);
  const owned = ticket.raiserUid === userUid || ticket.createdBy === username;
  if (!staff && !owned) return null;
  return ticket;
}

/**
 * Open tickets that look like duplicates of this one (§4.4).
 *
 * SQL narrows to the same category inside the window; `ticket-core` then applies the actual
 * rule, including the "two anonymous guests are not the same entity" guard that a SQL
 * predicate would get wrong.
 */
export async function findDuplicatesFor(ticket: TicketLike, windowHours = DUPLICATE_WINDOW_HOURS) {
  const since = new Date(ticket.raisedAt.getTime() - windowHours * 60 * 60 * 1000);
  const until = new Date(ticket.raisedAt.getTime() + windowHours * 60 * 60 * 1000);

  const rows = await prisma.ticket.findMany({
    where: {
      id: { not: ticket.id },
      categoryCode: ticket.categoryCode,
      status: { in: [...OPEN_STATUSES] },
      mergedIntoTicketId: null,
      raisedAt: { gte: since, lte: until },
    },
    select: {
      ...TICKET_DETAIL_SELECT,
      category: { select: { categoryName: true } },
    },
    take: 50,
  });

  return findDuplicateCandidates(ticket, rows, windowHours).map(
    (t) => rows.find((r) => r.id === t.id)!
  );
}

export interface ActorContext {
  uid: number;
  username: string;
}

/**
 * Merges `absorbedId` into `survivorId` (§4.4).
 *
 * Always staff-confirmed — the duplicate probe only suggests. Writes a MERGE event to BOTH
 * tickets so the trail reads two-way from either end, and moves the survivor's clock to the
 * earlier of the two per the confirmed §4.4 rule. Neither ticket's raisedAt is touched.
 */
export async function mergeTickets(survivorId: number, absorbedId: number, actor: ActorContext) {
  if (survivorId === absorbedId) throw new Error("A ticket cannot be merged into itself.");

  return prisma.$transaction(async (tx) => {
    const [survivor, absorbed] = await Promise.all([
      tx.ticket.findUnique({ where: { id: survivorId }, select: TICKET_DETAIL_SELECT }),
      tx.ticket.findUnique({ where: { id: absorbedId }, select: TICKET_DETAIL_SELECT }),
    ]);
    if (!survivor || !absorbed) throw new Error("Ticket not found.");
    if (survivor.mergedIntoTicketId !== null || absorbed.mergedIntoTicketId !== null) {
      throw new Error("One of these tickets has already been merged into another thread.");
    }

    const now = new Date();
    const clockStart = mergedClockStart(survivor, absorbed);

    await tx.ticket.update({
      where: { id: absorbedId },
      data: { mergedIntoTicketId: survivorId, mergedAt: now, status: "MERGED", updatedBy: actor.username },
    });
    await tx.ticket.update({
      where: { id: survivorId },
      data: { slaClockStartAt: clockStart, updatedBy: actor.username },
    });

    await tx.ticketEvent.createMany({
      data: [
        {
          ticketId: survivorId,
          eventType: "MERGE",
          relatedTicketId: absorbedId,
          remarks:
            `Absorbed ${absorbed.ticketNo}. Turnaround clock now starts ${clockStart.toISOString()} ` +
            `(the earlier of the two tickets).`,
          actorUid: actor.uid,
          actorUsername: actor.username,
        },
        {
          ticketId: absorbedId,
          eventType: "MERGE",
          relatedTicketId: survivorId,
          fromStatus: absorbed.status,
          toStatus: "MERGED",
          remarks: `Merged into ${survivor.ticketNo}; no longer tracked separately.`,
          actorUid: actor.uid,
          actorUsername: actor.username,
        },
      ],
    });

    return { survivorTicketNo: survivor.ticketNo, absorbedTicketNo: absorbed.ticketNo, clockStart };
  });
}

/**
 * Master records matching a guest ticket's captured contact (§4.2).
 *
 * For a ticket that fell to guest *because* the contact matched several people, these are
 * exactly those people — so the panel offers precisely the choice the resolver refused to
 * make on its own.
 */
export async function suggestIdentityMatches(ticket: {
  guestEmail: string | null;
  guestMobile: string | null;
}) {
  const email = normalizeEmail(ticket.guestEmail);
  const mobile = normalizeMobile(ticket.guestMobile);
  const candidates = await findIdentityCandidates(email, mobile);
  if (candidates.length === 0) return [];

  return prisma.userDetails.findMany({
    where: { uid: { in: candidates.map((c) => c.uid) } },
    orderBy: { fullName: "asc" },
    select: { uid: true, fullName: true, username: true, email: true, mobile: true, hierarchyCode: true, isActive: true },
  });
}

/** Free-text lookup for reconciling a guest ticket to someone whose contact never matched —
 * a prospect since onboarded under a different address, for instance. */
export async function searchUsers(companyCode: string, query: string) {
  const q = query.trim();
  if (q.length < 2) return [];
  return prisma.userDetails.findMany({
    where: {
      companyCode,
      OR: [
        { fullName: { contains: q, mode: "insensitive" } },
        { username: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { mobile: { contains: q } },
        { customerId: { contains: q, mode: "insensitive" } },
      ],
    },
    orderBy: { fullName: "asc" },
    take: 20,
    select: { uid: true, fullName: true, username: true, email: true, mobile: true, hierarchyCode: true, isActive: true },
  });
}

/**
 * Links a guest ticket to a master record (§4.2).
 *
 * The guest* columns are deliberately left in place. They are what intake actually captured,
 * and keeping them means the ticket still shows the caller's own words for who they were,
 * even after someone decided which record that referred to.
 */
export async function reconcileTicketIdentity(ticketId: number, userUid: number, actor: ActorContext) {
  return prisma.$transaction(async (tx) => {
    const ticket = await tx.ticket.findUnique({ where: { id: ticketId }, select: TICKET_DETAIL_SELECT });
    if (!ticket) throw new Error("Ticket not found.");
    if (!canReconcile(ticket)) {
      throw new Error(
        ticket.mergedIntoTicketId !== null
          ? "This ticket has been merged — reconcile the surviving thread instead."
          : "This ticket is already linked to a person."
      );
    }

    const user = await tx.userDetails.findUnique({
      where: { uid: userUid },
      select: { uid: true, fullName: true, username: true, hierarchyCode: true },
    });
    if (!user) throw new Error("That person no longer exists in master data.");

    const raiserType = raiserTypeForHierarchy(user.hierarchyCode);
    await tx.ticket.update({
      where: { id: ticketId },
      data: { raiserUid: user.uid, raiserType, updatedBy: actor.username },
    });

    await tx.ticketEvent.create({
      data: {
        ticketId,
        eventType: "IDENTITY_RECONCILED",
        toUserUid: user.uid,
        toUsername: user.username,
        remarks:
          `Linked to ${user.fullName} (${user.username}) as ${raiserType.toLowerCase()}. ` +
          `Captured at intake as: ${[ticket.guestName, ticket.guestEmail, ticket.guestMobile].filter(Boolean).join(", ") || "no contact details"}.`,
        actorUid: actor.uid,
        actorUsername: actor.username,
      },
    });

    return { raiserType, fullName: user.fullName };
  });
}

export type TicketAction =
  | { kind: "REMARK"; remarks: string }
  | { kind: "STATUS"; toStatus: string; remarks: string | null }
  | { kind: "FORWARD"; toUserUid: number; remarks: string }
  | { kind: "ETA"; revisedEta: Date; remarks: string | null };

/**
 * Applies one staff action and records it (§4.5). Ticket mutation and audit event are
 * written together, so the trail can never disagree with the row it describes.
 */
export async function applyTicketAction(ticketId: number, action: TicketAction, actor: ActorContext) {
  return prisma.$transaction(async (tx) => {
    const ticket = await tx.ticket.findUnique({ where: { id: ticketId }, select: TICKET_DETAIL_SELECT });
    if (!ticket) throw new Error("Ticket not found.");
    if (ticket.mergedIntoTicketId !== null) {
      throw new Error("This ticket has been merged into another thread — act on that one instead.");
    }

    const now = new Date();
    // §4.5's response target is measured against the first time anyone other than the raiser
    // engages, so it is stamped by whichever action happens to be first.
    const firstResponseAt =
      ticket.firstResponseAt ?? (actor.uid !== ticket.raiserUid ? now : null);

    const data: Record<string, unknown> = { updatedBy: actor.username, firstResponseAt };
    const event: Record<string, unknown> = {
      ticketId,
      actorUid: actor.uid,
      actorUsername: actor.username,
      remarks: "remarks" in action ? action.remarks : null,
    };

    switch (action.kind) {
      case "REMARK":
        event.eventType = "REMARK";
        break;

      case "STATUS": {
        if (!canTransition(ticket.status, action.toStatus)) {
          throw new Error(`A ${ticket.status.toLowerCase()} ticket cannot move to ${action.toStatus.toLowerCase()}.`);
        }
        const stamps = timestampsForTransition(action.toStatus, now, {
          resolvedAt: ticket.resolvedAt,
          closedAt: ticket.closedAt,
        });
        data.status = action.toStatus;
        data.resolvedAt = stamps.resolvedAt;
        data.closedAt = stamps.closedAt;
        event.eventType = "STATUS_CHANGE";
        event.fromStatus = ticket.status;
        event.toStatus = action.toStatus;
        break;
      }

      case "FORWARD": {
        const to = await tx.userDetails.findUnique({
          where: { uid: action.toUserUid },
          select: { uid: true, username: true, isActive: true },
        });
        if (!to || !to.isActive) throw new Error("That person is not an active user.");

        const from = ticket.assignedToUid
          ? await tx.userDetails.findUnique({ where: { uid: ticket.assignedToUid }, select: { username: true } })
          : null;

        data.assignedToUid = to.uid;
        data.status = canTransition(ticket.status, "FORWARDED") ? "FORWARDED" : ticket.status;
        event.eventType = "FORWARD";
        event.fromUserUid = ticket.assignedToUid;
        event.fromUsername = from?.username ?? null;
        event.toUserUid = to.uid;
        event.toUsername = to.username;
        event.fromStatus = ticket.status;
        event.toStatus = data.status;
        break;
      }

      case "ETA":
        data.revisedEta = action.revisedEta;
        event.eventType = "ETA_REVISED";
        event.revisedEta = action.revisedEta;
        break;
    }

    await tx.ticket.update({ where: { id: ticketId }, data });
    await tx.ticketEvent.create({ data: event as Parameters<typeof tx.ticketEvent.create>[0]["data"] });
    return { ok: true };
  });
}

/**
 * The triage queue (§4.5): every ticket, oldest first so the longest-waiting surfaces top.
 * Absorbed tickets are excluded — their thread is the survivor now.
 */
export async function listTriageQueue(options: { status?: string; onlyMine?: number } = {}) {
  return prisma.ticket.findMany({
    where: {
      mergedIntoTicketId: null,
      ...(options.status ? { status: options.status } : { status: { in: [...OPEN_STATUSES] } }),
      ...(options.onlyMine ? { assignedToUid: options.onlyMine } : {}),
    },
    orderBy: { slaClockStartAt: "asc" },
    take: 200,
    select: {
      id: true,
      ticketNo: true,
      subject: true,
      status: true,
      channel: true,
      raisedAt: true,
      slaClockStartAt: true,
      firstResponseAt: true,
      mergedIntoTicketId: true,
      guestName: true,
      category: { select: { categoryName: true } },
      raiser: { select: { fullName: true } },
      assignedTo: { select: { fullName: true } },
    },
  });
}

/**
 * Active users a ticket can be forwarded to. Support staff only ever forward internally, so
 * clients (hierarchy 0800) and family accounts are excluded.
 */
export async function listForwardTargets(companyCode: string) {
  return prisma.userDetails.findMany({
    where: { companyCode, isActive: true, hierarchyCode: { notIn: ["0800", "0700"] } },
    orderBy: { fullName: "asc" },
    select: { uid: true, fullName: true, username: true },
  });
}

export async function listActiveCategories() {
  return prisma.issueCategory.findMany({
    where: { isActive: true },
    orderBy: [{ displayOrder: "asc" }, { categoryName: "asc" }],
    select: { categoryCode: true, categoryName: true, productModule: true },
  });
}
