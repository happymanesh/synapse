import { z } from "zod";
import { TICKET_TYPES } from "@/lib/ticket-core";

/**
 * Validation for ticket intake (BRS §4.1). Shared by the raise screen and POST /api/tickets.
 *
 * A blank field submits "" — the same trap as optional FKs in admin-schemas.ts — so every
 * optional string is preprocessed to null rather than written through as an empty string.
 */
const optionalString = z.preprocess((v) => (v === "" || v === undefined ? null : v), z.string().nullable());

export const CHANNELS = ["WEBSITE", "WHATSAPP", "PHONE", "SYNAPSE"] as const;
export type Channel = (typeof CHANNELS)[number];

/** Chosen in the Application/Segment dropdowns to mean "not listed — let me add it". The
 * server creates the master row; the id itself is resolved there, never trusted from here. */
export const NEW_OPTION_SENTINEL = "__NEW__";

/** Deliberately loose. Rejecting unusual-but-valid addresses would push a legitimate raiser
 * onto the guest path for no benefit; delivery failure is recorded on the queued message. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const createTicketSchema = z
  .object({
    // --- classification, on three independent axes ---------------------------
    ticketType: z.enum(TICKET_TYPES, { error: "Choose a type." }),
    /** Required when ticketType is OTHERS. */
    typeOther: optionalString,
    /** A numeric master id as a string, or NEW_OPTION_SENTINEL. */
    applicationId: z.string().min(1, { error: "Choose an application." }),
    applicationNew: optionalString,
    segmentId: z.string().min(1, { error: "Choose a segment." }),
    segmentNew: optionalString,

    subject: z.string().trim().min(3, { error: "Give the issue a short subject." }).max(200),
    description: z.string().trim().min(5, { error: "Describe the issue." }).max(5000),
    channel: z.enum(CHANNELS).default("SYNAPSE"),

    /** True when a staff member is logging this for someone who contacted them (§4.1 phone
     * intake). Server-side this also requires the caller to hold the support queue menu —
     * the flag alone grants nothing. */
    forSomeoneElse: z.boolean().default(false),
    contactName: optionalString,
    contactEmail: optionalString,
    contactMobile: optionalString,
    contactClientCode: optionalString,
  })
  .refine((v) => v.ticketType !== "OTHERS" || (typeof v.typeOther === "string" && v.typeOther.trim().length > 0), {
    error: "Mention what kind of request this is.",
    path: ["typeOther"],
  })
  .refine(
    (v) => v.applicationId !== NEW_OPTION_SENTINEL || (typeof v.applicationNew === "string" && v.applicationNew.trim().length > 0),
    { error: "Enter the new application name.", path: ["applicationNew"] }
  )
  .refine(
    (v) => v.segmentId !== NEW_OPTION_SENTINEL || (typeof v.segmentNew === "string" && v.segmentNew.trim().length > 0),
    { error: "Enter the new segment name.", path: ["segmentNew"] }
  )
  .refine((v) => !v.forSomeoneElse || (typeof v.contactName === "string" && v.contactName.trim().length > 0), {
    error: "Enter the caller's name (use 'Unknown caller' if they did not give one).",
    path: ["contactName"],
  })
  .refine((v) => !v.contactEmail || EMAIL_SHAPE.test(v.contactEmail), {
    error: "That doesn't look like an email address.",
    path: ["contactEmail"],
  });

export type CreateTicketInput = z.infer<typeof createTicketSchema>;

/** Master-data rows the desk maintains for the two extensible axes. */
export const masterListSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, { error: "Give it a code." })
    .max(40)
    .regex(/^[A-Z0-9_-]+$/, { error: "Use capitals, digits, hyphen or underscore only, e.g. BACK-OFFICE." }),
  name: z.string().trim().min(1, { error: "Give it a name." }).max(120),
  displayOrder: z.coerce.number().int(),
  isActive: z.boolean(),
});
export const masterListUpdateSchema = masterListSchema.omit({ code: true });
