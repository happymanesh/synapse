/**
 * Pure rules for the issue tracker: who raised a ticket, whether two tickets are the same
 * issue, and how long a ticket has been open.
 *
 * Deliberately free of `server-only` and of any Prisma import so it can be unit tested
 * directly (see tests/ticket-core.test.ts). The DB-backed callers that feed it rows live in
 * `@/lib/tickets`. Per CLAUDE.md, any new access or scoping *rule* belongs here with a test,
 * not inline in a query — these three in particular decide attribution, what gets merged,
 * and what the §4.8 turnaround metric reports, and all three fail silently when wrong.
 *
 * Spec: docs/04-issue-tracker-brs.md.
 */

// ---------------------------------------------------------------------------
// Identity resolution (BRS §4.2)
// ---------------------------------------------------------------------------

/**
 * PROSPECT is a staff-assigned label at intake, never a resolution outcome — a prospect is
 * by definition absent from master data, so resolveRaiser() returns GUEST for them.
 */
export type RaiserType = "EMPLOYEE" | "CLIENT" | "PARTNER" | "PROSPECT" | "GUEST";

export interface MasterUserRow {
  uid: number;
  hierarchyCode: string;
  email: string | null;
  mobile: string | null;
  isActive: boolean;
}

export interface RaiserContact {
  email?: string | null;
  mobile?: string | null;
}

export interface ResolvedRaiser {
  raiserUid: number | null;
  raiserType: RaiserType;
  matchedOn: "EMAIL" | "MOBILE" | null;
  /**
   * True when the contact matched more than one person and we refused to guess. The ticket
   * still proceeds as a guest ticket; staff reconcile it manually.
   */
  ambiguous: boolean;
}

const CLIENT_HIERARCHY = "0800";
const FAMILY_HIERARCHY = "0700";
const PARTNER_HIERARCHIES = new Set(["0400", "0500", "0600"]); // Franchisee, SubBroker, Remisier

/** Master data stores plain 10-digit numbers, but WhatsApp delivers E.164 ("919892953949")
 * and humans type "+91 98929 53949". Compare on the last 10 digits so all three match. */
export function normalizeMobile(mobile: string | null | undefined): string | null {
  if (!mobile) return null;
  const digits = mobile.replace(/\D/g, "");
  // Anything shorter than a full subscriber number (a shortcode, a truncated entry) is too
  // weak to identify a person — treat it as no contact rather than risk a wrong match.
  if (digits.length < 10) return null;
  return digits.slice(-10);
}

export function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const trimmed = email.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

export function raiserTypeForHierarchy(hierarchyCode: string): RaiserType {
  if (hierarchyCode === CLIENT_HIERARCHY || hierarchyCode === FAMILY_HIERARCHY) return "CLIENT";
  if (PARTNER_HIERARCHIES.has(hierarchyCode)) return "PARTNER";
  return "EMPLOYEE";
}

/**
 * Resolves a raiser against Synapse master data by email, then mobile.
 *
 * Never throws and never returns a failure: an unresolved raiser is a GUEST ticket, which
 * BRS §5 requires to be a fallback rather than an error state. Callers must not treat a
 * GUEST result as a reason to reject the ticket.
 *
 * Email wins over mobile because a shared mobile is common (family accounts) while a shared
 * mailbox on two master records is not. If a contact matches several people we return GUEST
 * with `ambiguous: true` rather than picking one — attributing a complaint to the wrong
 * client is worse than leaving it for a human to reconcile.
 *
 * Deactivated users still match. isActive governs whether someone may log in, not whether we
 * know who they are, and a former client's ticket should still link to their record.
 */
export function resolveRaiser(contact: RaiserContact, candidates: MasterUserRow[]): ResolvedRaiser {
  const guest: ResolvedRaiser = { raiserUid: null, raiserType: "GUEST", matchedOn: null, ambiguous: false };

  const email = normalizeEmail(contact.email);
  if (email) {
    const matches = candidates.filter((c) => normalizeEmail(c.email) === email);
    if (matches.length === 1) {
      return {
        raiserUid: matches[0].uid,
        raiserType: raiserTypeForHierarchy(matches[0].hierarchyCode),
        matchedOn: "EMAIL",
        ambiguous: false,
      };
    }
    if (matches.length > 1) return { ...guest, ambiguous: true };
  }

  const mobile = normalizeMobile(contact.mobile);
  if (mobile) {
    const matches = candidates.filter((c) => normalizeMobile(c.mobile) === mobile);
    if (matches.length === 1) {
      return {
        raiserUid: matches[0].uid,
        raiserType: raiserTypeForHierarchy(matches[0].hierarchyCode),
        matchedOn: "MOBILE",
        ambiguous: false,
      };
    }
    if (matches.length > 1) return { ...guest, ambiguous: true };
  }

  return guest;
}

export interface ReconcilableTicket {
  raiserUid: number | null;
  mergedIntoTicketId: number | null;
}

/**
 * Whether a guest ticket can still be linked to a master record (§4.2 — "reconcile to master
 * data later, e.g. once a prospect is onboarded as a client").
 *
 * Only unresolved tickets qualify: re-pointing an already-attributed ticket at a different
 * person would silently rewrite who raised it, which is precisely what the audit trail
 * exists to prevent. An absorbed ticket is excluded too — reconcile the surviving thread.
 */
export function canReconcile(ticket: ReconcilableTicket): boolean {
  return ticket.raiserUid === null && ticket.mergedIntoTicketId === null;
}

// ---------------------------------------------------------------------------
// Classification: type / application / segment
// ---------------------------------------------------------------------------

/**
 * The type axis. Fixed rather than master data, because it is a reporting dimension: left
 * open it degrades into near-duplicates ("Bug"/"bug"/"Bugs") that split a report silently.
 * Application and segment ARE master data — they genuinely grow.
 */
export const TICKET_TYPES = ["ISSUE", "COMPLAINT", "BUG", "REQUEST", "CLARIFICATION", "OTHERS"] as const;
export type TicketType = (typeof TICKET_TYPES)[number];

export const TICKET_TYPE_LABELS: Record<TicketType, string> = {
  ISSUE: "Issue",
  COMPLAINT: "Complaint",
  BUG: "Bug",
  REQUEST: "Request",
  CLARIFICATION: "Clarification",
  OTHERS: "Others",
};

/** OTHERS is only meaningful with the "please mention" text beside it — an unqualified
 * "Others" tells a report nothing and tells the desk even less. */
export function requiresTypeOther(ticketType: string): boolean {
  return ticketType === "OTHERS";
}

/** What to show for a ticket's type: the mentioned text for OTHERS, else the label. */
export function describeTicketType(ticketType: string, typeOther: string | null): string {
  if (requiresTypeOther(ticketType)) {
    return typeOther?.trim() ? `Others — ${typeOther.trim()}` : "Others";
  }
  return TICKET_TYPE_LABELS[ticketType as TicketType] ?? ticketType;
}

// ---------------------------------------------------------------------------
// Duplicate detection (BRS §4.4)
// ---------------------------------------------------------------------------

/** Statuses that still count as "being worked on" — only these can be duplicates of each other. */
export const OPEN_STATUSES = ["OPEN", "IN_PROGRESS", "FORWARDED", "AWAITING_CR_APPROVAL"] as const;

/** §4.4 specifies a rolling 24–48h window; 48 is the permissive end, so staff see more
 * candidates and decide. The confirmation is always a manual checkbox, never automatic. */
export const DUPLICATE_WINDOW_HOURS = 48;

export interface TicketLike {
  id: number;
  applicationId: number;
  ticketType: string;
  status: string;
  raisedAt: Date;
  raiserUid: number | null;
  clientCode: string | null;
  guestEmail: string | null;
  guestMobile: string | null;
  mergedIntoTicketId: number | null;
}

export function isOpenStatus(status: string): boolean {
  return (OPEN_STATUSES as readonly string[]).includes(status);
}

/**
 * Whether two tickets came from the same entity.
 *
 * Checked in order of how strongly each key identifies someone: a resolved uid, then a
 * client code, then a guest contact. Two guest tickets carrying no identifying detail at all
 * are NOT the same entity — otherwise every anonymous ticket in a category would look like a
 * duplicate of every other one, and staff would be offered nonsense merges.
 */
export function isSameEntity(a: TicketLike, b: TicketLike): boolean {
  if (a.raiserUid !== null && b.raiserUid !== null) return a.raiserUid === b.raiserUid;
  if (a.clientCode && b.clientCode) return a.clientCode === b.clientCode;

  const emailA = normalizeEmail(a.guestEmail);
  const emailB = normalizeEmail(b.guestEmail);
  if (emailA && emailB) return emailA === emailB;

  const mobileA = normalizeMobile(a.guestMobile);
  const mobileB = normalizeMobile(b.guestMobile);
  if (mobileA && mobileB) return mobileA === mobileB;

  return false;
}

/**
 * Deterministic duplicate test: same application AND type, same entity, both still open,
 * raised within the window. No text similarity — §4.4 is explicit that Phase 1 matches on
 * structured fields only, so the result is explainable to the staff member confirming it.
 *
 * Both classification axes must agree. Matching on application alone would offer a bug and
 * a billing query about the same system as duplicates of each other; type alone is far too
 * broad to mean anything.
 */
export function isLikelyDuplicate(a: TicketLike, b: TicketLike, windowHours = DUPLICATE_WINDOW_HOURS): boolean {
  if (a.id === b.id) return false;
  // An already-absorbed ticket is no longer tracked separately, so it must never be offered
  // again — merging into it would strand history behind two hops.
  if (a.mergedIntoTicketId !== null || b.mergedIntoTicketId !== null) return false;
  if (!isOpenStatus(a.status) || !isOpenStatus(b.status)) return false;
  if (a.applicationId !== b.applicationId) return false;
  if (a.ticketType !== b.ticketType) return false;
  if (!isSameEntity(a, b)) return false;

  const deltaMs = Math.abs(a.raisedAt.getTime() - b.raisedAt.getTime());
  return deltaMs <= windowHours * 60 * 60 * 1000;
}

/** The open tickets to surface as likely duplicates while staff answer `target`, newest first. */
export function findDuplicateCandidates(
  target: TicketLike,
  candidates: TicketLike[],
  windowHours = DUPLICATE_WINDOW_HOURS
): TicketLike[] {
  return candidates
    .filter((c) => isLikelyDuplicate(target, c, windowHours))
    .sort((a, b) => b.raisedAt.getTime() - a.raisedAt.getTime());
}

// ---------------------------------------------------------------------------
// Merge clock and turnaround (BRS §4.4, §4.8)
// ---------------------------------------------------------------------------

export interface ClockLike {
  raisedAt: Date;
  slaClockStartAt: Date;
}

/**
 * The surviving thread's turnaround clock after a merge: the earlier of the two.
 * Confirmed rule (BRS §4.4 / §11.1) — merging must not be usable to understate elapsed time
 * in the §4.8 average-turnaround metric.
 *
 * Compares `slaClockStartAt`, not `raisedAt`, and that distinction is load-bearing: a
 * survivor may already have absorbed an earlier ticket, so its clock can predate its own
 * raisedAt. Comparing raisedAt would silently reset the clock forward on the second merge of
 * a chain.
 *
 * Neither ticket's own `raisedAt` is ever rewritten — the audit trail still shows what
 * actually happened.
 */
export function mergedClockStart(survivor: ClockLike, absorbed: ClockLike): Date {
  return survivor.slaClockStartAt <= absorbed.slaClockStartAt ? survivor.slaClockStartAt : absorbed.slaClockStartAt;
}

export interface TurnaroundLike {
  slaClockStartAt: Date;
  resolvedAt: Date | null;
  mergedIntoTicketId: number | null;
}

/** Elapsed time for one ticket: to resolution, or to `now` if still open. */
export function turnaroundMs(ticket: TurnaroundLike, now: Date = new Date()): number {
  const end = ticket.resolvedAt ?? now;
  return Math.max(0, end.getTime() - ticket.slaClockStartAt.getTime());
}

/**
 * Average turnaround across resolved tickets (§4.8).
 *
 * Absorbed tickets are excluded: after a merge their history lives on the surviving thread,
 * so counting both would double-count one issue and — because the absorbed row keeps its own
 * short clock — drag the average down. This exclusion is the whole reason the merge rule
 * matters, so it lives here rather than being re-remembered in each report's SQL.
 *
 * Returns null when nothing qualifies, rather than 0, so a report can distinguish "no data"
 * from "instant".
 */
export function averageTurnaroundMs(tickets: TurnaroundLike[]): number | null {
  const counted = tickets.filter((t) => t.mergedIntoTicketId === null && t.resolvedAt !== null);
  if (counted.length === 0) return null;
  const total = counted.reduce((sum, t) => sum + turnaroundMs(t), 0);
  return total / counted.length;
}

// ---------------------------------------------------------------------------
// Status transitions (BRS §4.5)
// ---------------------------------------------------------------------------

export const TICKET_STATUSES = [
  "OPEN",
  "IN_PROGRESS",
  "FORWARDED",
  "AWAITING_CR_APPROVAL",
  "RESOLVED",
  "CLOSED",
  "MERGED",
] as const;

/**
 * Legal status moves.
 *
 * MERGED has no outgoing moves and is not a target of any: it is set only by the merge
 * service, and an absorbed ticket is frozen thereafter — its history now lives on the
 * surviving thread, so letting staff reopen it would fork the trail in two.
 *
 * Reopening is allowed from RESOLVED and CLOSED because a client replying "that didn't fix
 * it" is ordinary, and forcing a second ticket would restart the turnaround clock and hide
 * the real elapsed time.
 */
const TRANSITIONS: Record<string, readonly string[]> = {
  OPEN: ["IN_PROGRESS", "FORWARDED", "AWAITING_CR_APPROVAL", "RESOLVED", "CLOSED"],
  IN_PROGRESS: ["OPEN", "FORWARDED", "AWAITING_CR_APPROVAL", "RESOLVED", "CLOSED"],
  FORWARDED: ["OPEN", "IN_PROGRESS", "AWAITING_CR_APPROVAL", "RESOLVED", "CLOSED"],
  // Set by the §4.6 conversion flow; management approval closes it, rejection sends it back.
  AWAITING_CR_APPROVAL: ["OPEN", "IN_PROGRESS", "CLOSED"],
  RESOLVED: ["OPEN", "CLOSED"],
  CLOSED: ["OPEN"],
  MERGED: [],
};

export function canTransition(from: string, to: string): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function allowedTransitions(from: string): readonly string[] {
  return TRANSITIONS[from] ?? [];
}

export interface StatusTimestamps {
  resolvedAt: Date | null;
  closedAt: Date | null;
}

/**
 * The resolvedAt/closedAt a ticket should carry after moving to `to`.
 *
 * Closing stamps resolvedAt too when it is not already set. A ticket closed without ever
 * being marked resolved would otherwise vanish from the §4.8 average-turnaround metric
 * entirely — which would make closing tickets outright the cheapest way to keep the average
 * looking good. Every ending should cost what it actually took.
 *
 * Reopening clears both: a reopened ticket is genuinely not resolved, and leaving a stale
 * resolvedAt behind would report a turnaround that ended before the work did.
 */
export function timestampsForTransition(to: string, now: Date, current: StatusTimestamps): StatusTimestamps {
  if (to === "RESOLVED") return { resolvedAt: now, closedAt: null };
  if (to === "CLOSED") return { resolvedAt: current.resolvedAt ?? now, closedAt: now };
  if (to === "OPEN" || to === "IN_PROGRESS" || to === "FORWARDED" || to === "AWAITING_CR_APPROVAL") {
    return { resolvedAt: null, closedAt: null };
  }
  return current;
}

// ---------------------------------------------------------------------------
// Change requests (BRS §4.6)
// ---------------------------------------------------------------------------

export const BACKLOG_STATUSES = ["BACKLOG", "PLANNED", "IN_DEVELOPMENT", "RELEASED", "DROPPED"] as const;

export interface ProposableTicket {
  status: string;
  mergedIntoTicketId: number | null;
  hasChangeRequest: boolean;
}

/**
 * Whether a ticket can be put forward as a change request.
 *
 * One per ticket (the DB enforces it with a unique key on ticket_id, and this is the check
 * that turns that constraint into a sensible message). A ticket already awaiting a decision
 * is excluded even though that status counts as open — proposing twice would leave two
 * pending items for management to reconcile.
 */
export function canProposeChangeRequest(ticket: ProposableTicket): boolean {
  return (
    !ticket.hasChangeRequest &&
    ticket.mergedIntoTicketId === null &&
    isOpenStatus(ticket.status) &&
    ticket.status !== "AWAITING_CR_APPROVAL"
  );
}

/**
 * Only a pending change request can be decided.
 *
 * §4.6 gives Product/Ops the approval authority precisely so the desk cannot park work in
 * the backlog on its own; letting a decision be revisited here would hand back the same
 * power by another route. Reopening a settled item is a new ticket, not an edit.
 */
export function canDecideChangeRequest(cr: { approvalStatus: string }): boolean {
  return cr.approvalStatus === "PENDING";
}

/** Where a ticket goes once its change request is settled: closed if the work was accepted
 * (§4.6 — "considered for a future release"), otherwise back to the desk to be handled. */
export function ticketStatusAfterDecision(decision: "APPROVED" | "REJECTED"): string {
  return decision === "APPROVED" ? "CLOSED" : "IN_PROGRESS";
}

// ---------------------------------------------------------------------------
// Response target (BRS §4.5)
// ---------------------------------------------------------------------------

/** Flat for every ticket regardless of category — §2 records that severity tiers were
 * explicitly decided against for Phase 1. */
export const RESPONSE_TARGET_HOURS = 24;

export interface ResponseLike {
  slaClockStartAt: Date;
  firstResponseAt: Date | null;
  status: string;
  mergedIntoTicketId: number | null;
}

/**
 * Whether a ticket has gone past the flat response target without a first response.
 * Drives the §4.5 morning pending list. Absorbed and closed tickets never breach.
 */
export function hasBreachedResponseTarget(
  ticket: ResponseLike,
  now: Date = new Date(),
  targetHours = RESPONSE_TARGET_HOURS
): boolean {
  if (ticket.mergedIntoTicketId !== null) return false;
  if (ticket.firstResponseAt !== null) return false;
  if (!isOpenStatus(ticket.status)) return false;
  return now.getTime() - ticket.slaClockStartAt.getTime() > targetHours * 60 * 60 * 1000;
}
