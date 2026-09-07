import "server-only";
import { prisma } from "@/lib/db";
import {
  planDocumentDelivery,
  requiresClientCode,
  validatePeriod,
  UnavailableDocumentGenerator,
  type DocumentGenerator,
} from "@/lib/document-core";

/**
 * DB-backed layer for document service requests (BRS §4.7).
 *
 * Deliberately not a Ticket: §4.7 describes a lighter-weight automated flow with no triage,
 * no assignment and no SLA clock.
 *
 * Generation sits behind `DocumentGenerator`. Phase 1 ships the unavailable implementation,
 * because the ledger/margin/contract-note source tables aren't in this database and no PDF
 * renderer is installed — so a request is recorded and verified, and only the bytes are
 * missing. Swapping in a real generator is the only change needed later.
 */
const generator: DocumentGenerator = new UnavailableDocumentGenerator();

export interface DocumentRequestInput {
  documentType: string;
  clientCode: string | null;
  fromDate: Date | null;
  toDate: Date | null;
  channel: string;
}

export interface DocumentRequestResult {
  requestNo: string;
  status: string;
  deliverTo: string;
  cc: string | null;
  selfService: boolean;
  /** Set when generation is not yet wired — the request is still recorded. */
  pendingReason: string | null;
}

export async function requestDocument(
  input: DocumentRequestInput,
  requesterUid: number,
  requesterUsername: string
): Promise<DocumentRequestResult> {
  const requester = await prisma.userDetails.findUnique({
    where: { uid: requesterUid },
    select: { uid: true, hierarchyCode: true, email: true, customerId: true, companyCode: true },
  });
  if (!requester) throw new Error("Your account could not be found.");

  if (requiresClientCode(input.documentType) && !input.clientCode) {
    throw new Error("A ledger request needs a client code.");
  }
  const periodError = validatePeriod(input.fromDate, input.toDate);
  if (periodError) throw new Error(periodError);

  // Look the client up only for a staff request; a client's own request never consults the
  // submitted code, so resolving it would be pointless at best and misleading at worst.
  const code = input.clientCode?.trim() ?? null;
  const targetClient =
    code && requester.hierarchyCode !== "0800" && requester.hierarchyCode !== "0700"
      ? await prisma.userDetails.findFirst({
          where: {
            companyCode: requester.companyCode,
            customerId: { equals: code, mode: "insensitive" },
            hierarchyCode: { in: ["0800", "0700"] },
            isActive: true,
          },
          select: { uid: true, email: true, customerId: true },
        })
      : null;

  const plan = planDocumentDelivery(requester, targetClient, code);
  if (!plan.ok) throw new Error(plan.reason);

  const generated = await generator.generate({
    documentType: input.documentType,
    clientCode: plan.clientCode,
    fromDate: input.fromDate,
    toDate: input.toDate,
  });

  const request = await prisma.serviceRequest.create({
    data: {
      documentType: input.documentType,
      clientCode: plan.clientCode,
      fromDate: input.fromDate,
      toDate: input.toDate,
      requestedByUid: requester.uid,
      forClientUid: plan.forClientUid,
      channel: input.channel,
      // Resolved from master data above — never read from the request body.
      deliverToEmail: plan.deliverTo,
      ccEmail: plan.cc,
      reportId: generated.available ? generated.reportId : null,
      status: generated.available ? "GENERATED" : "PENDING",
      generatedAt: generated.available ? new Date() : null,
      failureReason: generated.available ? null : generated.reason,
      createdBy: requesterUsername,
    },
    select: { id: true, requestNo: true, status: true },
  });

  // Delivery is queued only for a document that actually exists. Queueing an email that
  // claims to carry a statement with nothing attached would go out for real the moment a
  // provider is wired behind sendMessage() — worse than sending nothing.
  if (generated.available) {
    await prisma.channelMessage.create({
      data: {
        direction: "OUTBOUND",
        channel: "EMAIL",
        purpose: "DOCUMENT_DELIVERY",
        serviceRequestId: request.id,
        counterparty: plan.deliverTo,
        ccList: plan.cc,
        subject: `${input.documentType.replace(/_/g, " ").toLowerCase()} for ${plan.clientCode}`,
        body: `Please find attached the requested document for client ${plan.clientCode}.`,
        status: "QUEUED",
      },
    });
  }

  return {
    requestNo: request.requestNo,
    status: request.status,
    deliverTo: plan.deliverTo,
    cc: plan.cc,
    selfService: plan.selfService,
    pendingReason: generated.available ? null : generated.reason,
  };
}

/**
 * A user's own document requests, plus everything if they run the desk.
 *
 * Follows the CLAUDE.md ownership rule: these rows name client codes and delivery addresses,
 * so the default is your own only.
 */
export async function listDocumentRequests(userUid: number, isStaff: boolean) {
  return prisma.serviceRequest.findMany({
    where: isStaff ? {} : { OR: [{ requestedByUid: userUid }, { forClientUid: userUid }] },
    orderBy: { requestedAt: "desc" },
    take: 100,
    select: {
      id: true,
      requestNo: true,
      documentType: true,
      clientCode: true,
      fromDate: true,
      toDate: true,
      status: true,
      requestedAt: true,
      deliveredAt: true,
      failureReason: true,
      deliverToEmail: true,
      ccEmail: true,
      requestedBy: { select: { fullName: true } },
    },
  });
}
