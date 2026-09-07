import { z } from "zod";

/**
 * Validation for ticket intake (BRS §4.1). Shared by the raise screen and POST /api/tickets.
 *
 * A blank field submits "" — the same trap as optional FKs in admin-schemas.ts — so every
 * optional string is preprocessed to null rather than written through as an empty string.
 */
const optionalString = z.preprocess((v) => (v === "" || v === undefined ? null : v), z.string().nullable());

export const CHANNELS = ["WEBSITE", "WHATSAPP", "PHONE", "SYNAPSE"] as const;
export type Channel = (typeof CHANNELS)[number];

/** Deliberately loose. Rejecting unusual-but-valid addresses would push a legitimate raiser
 * onto the guest path for no benefit; delivery failure is recorded on the queued message. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const createTicketSchema = z
  .object({
    categoryCode: z.string().min(1, { error: "Choose a category." }),
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
  .refine((v) => !v.forSomeoneElse || (typeof v.contactName === "string" && v.contactName.trim().length > 0), {
    error: "Enter the caller's name (use 'Unknown caller' if they did not give one).",
    path: ["contactName"],
  })
  .refine((v) => !v.contactEmail || EMAIL_SHAPE.test(v.contactEmail), {
    error: "That doesn't look like an email address.",
    path: ["contactEmail"],
  });

export type CreateTicketInput = z.infer<typeof createTicketSchema>;
