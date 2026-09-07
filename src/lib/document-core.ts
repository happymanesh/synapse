/**
 * Pure rules for automated document service requests (BRS §4.7).
 *
 * Deliberately free of `server-only` and of any Prisma import so it can be unit tested
 * directly (see tests/document-core.test.ts). `@/lib/documents` is the DB-backed layer.
 *
 * These rules carry more weight than their size suggests. §4.7 explicitly decided against
 * OTP/MFA — "email match is sufficient" — which means the decision about *which address a
 * financial document is sent to* is the entire verification. Everything here exists to make
 * that decision from master data rather than from anything the caller supplied.
 */

export const DOCUMENT_TYPES = ["LEDGER", "MARGIN_REPORT", "CONTRACT_NOTE"] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  LEDGER: "Ledger",
  MARGIN_REPORT: "Margin Report",
  CONTRACT_NOTE: "Contract Note",
};

/** §4.7: "Ledger requests require a mandatory client code." Mirrored by a CHECK constraint
 * in the migration, so the database refuses it too. */
export function requiresClientCode(documentType: string): boolean {
  return documentType === "LEDGER";
}

/** Clients hold hierarchy code 0800; family accounts (0700) are account holders too. */
const CLIENT_HIERARCHIES = new Set(["0800", "0700"]);

export function isClientHierarchy(hierarchyCode: string): boolean {
  return CLIENT_HIERARCHIES.has(hierarchyCode);
}

export interface RequesterInfo {
  uid: number;
  hierarchyCode: string;
  email: string | null;
  customerId: string | null;
}

export interface ClientInfo {
  uid: number;
  email: string | null;
  customerId: string | null;
}

export type DeliveryPlan =
  | {
      ok: true;
      /** Primary recipient. Always resolved from master data, never from the request body. */
      deliverTo: string;
      /** §4.7: an employee-raised request CCs the client, so a document pulled on their
       * account is always visible to them. Null for a client's own request. */
      cc: string | null;
      forClientUid: number;
      clientCode: string;
      selfService: boolean;
    }
  | { ok: false; reason: string };

/**
 * Decides who a requested document may be sent to.
 *
 * Two shapes, and the difference matters:
 *
 * - **A client requesting their own document.** The client code is taken from their own
 *   master record and the submitted one is ignored entirely. Trusting a submitted code would
 *   let any signed-in client pull any other client's ledger by typing a different number —
 *   with no OTP in the flow, nothing else would catch it.
 * - **An employee requesting on a client's behalf.** It goes to the employee who asked, and
 *   the client is CC'd so a pull on their account is never invisible to them.
 *
 * A client with no registered email is refused rather than delivered elsewhere: their address
 * on file *is* the verification, so its absence means there is nothing to verify against.
 */
export function planDocumentDelivery(
  requester: RequesterInfo,
  client: ClientInfo | null,
  requestedClientCode: string | null
): DeliveryPlan {
  if (isClientHierarchy(requester.hierarchyCode)) {
    if (!requester.customerId) {
      return { ok: false, reason: "Your account has no client code on file, so documents can't be issued." };
    }
    if (!requester.email) {
      return { ok: false, reason: "Your account has no registered email address, so there is nowhere to send this." };
    }
    return {
      ok: true,
      deliverTo: requester.email,
      cc: null,
      forClientUid: requester.uid,
      // The submitted code is deliberately discarded.
      clientCode: requester.customerId,
      selfService: true,
    };
  }

  if (!requestedClientCode) {
    return { ok: false, reason: "Enter the client code this document is for." };
  }
  if (!client) {
    return { ok: false, reason: "No client found with that code." };
  }
  if (!client.email) {
    return { ok: false, reason: "That client has no registered email address, so the document can't be sent or copied to them." };
  }
  if (!requester.email) {
    return { ok: false, reason: "Your own account has no email address, so there is nowhere to send this." };
  }

  return {
    ok: true,
    deliverTo: requester.email,
    cc: client.email,
    forClientUid: client.uid,
    clientCode: client.customerId ?? requestedClientCode,
    selfService: false,
  };
}

/** A document covering a period needs both ends, and a range that runs backwards is a typo,
 * not a query. */
export function validatePeriod(from: Date | null, to: Date | null): string | null {
  if (from && to && from > to) return "The 'from' date must not be after the 'to' date.";
  if (to && to > new Date(Date.now() + 24 * 60 * 60 * 1000)) return "The 'to' date can't be in the future.";
  return null;
}

// ---------------------------------------------------------------------------
// Generation seam
// ---------------------------------------------------------------------------

export interface GeneratedDocument {
  available: true;
  /** Which ReportDefinition produced it, recorded on the request for later audit. */
  reportId: string | null;
  fileName: string;
  byteSize: number;
}

export interface UnavailableDocument {
  available: false;
  reason: string;
}

export type GenerationResult = GeneratedDocument | UnavailableDocument;

export interface DocumentGenerator {
  generate(input: {
    documentType: string;
    clientCode: string;
    fromDate: Date | null;
    toDate: Date | null;
  }): Promise<GenerationResult>;
}

/**
 * The Phase 1 generator: it produces nothing.
 *
 * The agreed design renders each document from a seeded ReportDefinition, but the ledger,
 * margin-report and contract-note tables do not exist in this database yet and no PDF
 * renderer is installed. Rather than pretend, this returns `available: false` with the
 * reason, and the service records that on the request.
 *
 * It deliberately does NOT queue a delivery message. A queued email claiming to carry a
 * statement, with nothing attached, would be worse than no email at all — and would go out
 * for real the moment a provider is wired behind sendMessage().
 */
export class UnavailableDocumentGenerator implements DocumentGenerator {
  async generate(_input: {
    documentType: string;
    clientCode: string;
    fromDate: Date | null;
    toDate: Date | null;
  }): Promise<GenerationResult> {
    return {
      available: false,
      reason:
        "Document generation isn't wired yet — the source tables and PDF renderer are still to be connected. " +
        "The request has been recorded and will be delivered once they are.",
    };
  }
}
