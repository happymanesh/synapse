import { z } from "zod";

/** Menu codes the Support module authorizes against. Kept in one place so a typo can't
 * silently grant or deny access in one file while working in another. */
export const SUPPORT_MENU = {
  QUEUE: "SUP_QUEUE",
  APPLICATIONS: "SUP_APPLICATIONS",
  SEGMENTS: "SUP_SEGMENTS",
  CHANGE_REQUESTS: "SUP_CR",
  DOCUMENTS: "SUP_DOCS",
} as const;

const optionalString = z.preprocess((v) => (v === "" || v === undefined ? null : v), z.string().nullable());

/**
 * Staff actions on a ticket (BRS §4.5), as a discriminated union — every action is
 * fundamentally "mutate the ticket and append an audit event", so one route handles them.
 *
 * FORWARD and REMARK both require text: §4.5 requires who, when AND *why* on a forward, and
 * a remark with no words is not a remark. A status change may stand alone, since the
 * from/to pair is itself the record.
 */
export const ticketActionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("REMARK"),
    remarks: z.string().trim().min(1, { error: "Write a remark before saving." }).max(4000),
  }),
  z.object({
    kind: z.literal("STATUS"),
    toStatus: z.enum(["OPEN", "IN_PROGRESS", "FORWARDED", "RESOLVED", "CLOSED"], {
      error: "Choose a status.",
    }),
    remarks: z.preprocess((v) => (v === "" || v === undefined ? null : v), z.string().max(4000).nullable()),
  }),
  z.object({
    kind: z.literal("FORWARD"),
    toUserUid: z.coerce.number().int().positive({ error: "Choose who to forward this to." }),
    remarks: z.string().trim().min(1, { error: "Say why you're forwarding it." }).max(4000),
  }),
  z.object({
    kind: z.literal("ETA"),
    revisedEta: z.coerce.date({ error: "Give a valid date and time." }),
    remarks: z.preprocess((v) => (v === "" || v === undefined ? null : v), z.string().max(4000).nullable()),
  }),
]);

/**
 * §4.7 document request.
 *
 * Note what is absent: no recipient field. The delivery address is resolved from master data
 * in `planDocumentDelivery`, never accepted from the caller — with no OTP in this flow, that
 * resolution is the entire verification, and a submitted address would make it a no-op.
 */
export const documentRequestSchema = z
  .object({
    documentType: z.enum(["LEDGER", "MARGIN_REPORT", "CONTRACT_NOTE"], { error: "Choose a document." }),
    clientCode: optionalString,
    fromDate: z.preprocess((v) => (v === "" || v === undefined ? null : v), z.coerce.date().nullable()),
    toDate: z.preprocess((v) => (v === "" || v === undefined ? null : v), z.coerce.date().nullable()),
  })
  .refine((v) => v.documentType !== "LEDGER" || (typeof v.clientCode === "string" && v.clientCode.trim().length > 0), {
    // Mirrors the CHECK constraint in the migration, so the user sees a field error rather
    // than a 500 from the database.
    error: "A ledger request needs a client code.",
    path: ["clientCode"],
  });

/** §4.6 conversion. The title and description are what Product/Ops decides on, so neither
 * may be blank — an empty proposal is not something anyone can sign off. */
export const proposeChangeRequestSchema = z.object({
  title: z.string().trim().min(5, { error: "Summarise the change in a line." }).max(200),
  description: z.string().trim().min(10, { error: "Describe what needs building and why." }).max(5000),
});

export const decideChangeRequestSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"], { error: "Approve or reject." }),
  remarks: z.preprocess((v) => (v === "" || v === undefined ? null : v), z.string().max(4000).nullable()),
  targetRelease: z.preprocess((v) => (v === "" || v === undefined ? null : v), z.string().max(60).nullable()),
});

export const backlogStatusSchema = z.object({
  backlogStatus: z.enum(["BACKLOG", "PLANNED", "IN_DEVELOPMENT", "RELEASED", "DROPPED"], {
    error: "Choose a backlog status.",
  }),
  targetRelease: z.preprocess((v) => (v === "" || v === undefined ? null : v), z.string().max(60).nullable()),
});

export const reconcileTicketSchema = z.object({
  userUid: z.coerce.number().int().positive({ error: "Choose the person to link this ticket to." }),
});

export const mergeTicketsSchema = z.object({
  absorbedTicketId: z.coerce.number().int().positive({ error: "Choose a ticket to merge in." }),
  /** §4.4 requires an explicit confirmation; the suggestion alone must never merge anything. */
  confirmed: z.literal(true, { error: "Tick the confirmation box to merge." }),
});
