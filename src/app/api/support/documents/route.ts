import { NextRequest, NextResponse } from "next/server";
import { guardMenu } from "@/lib/api-guard";
import { documentRequestSchema, SUPPORT_MENU } from "@/lib/support-schemas";
import { requestDocument } from "@/lib/documents";
import { adminErrorResponse } from "@/lib/admin-crud";

const DENIED = "You don't have access to document requests.";

export async function POST(request: NextRequest) {
  const { session, error } = await guardMenu(SUPPORT_MENU.DOCUMENTS, DENIED);
  if (error) return error;

  try {
    const body = documentRequestSchema.parse(await request.json());
    const result = await requestDocument(
      {
        documentType: body.documentType,
        clientCode: body.clientCode,
        fromDate: body.fromDate,
        toDate: body.toDate,
        channel: "SYNAPSE",
      },
      session.userUid,
      session.username
    );
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    // Refusals from planDocumentDelivery are deliberate, message-carrying errors meant for
    // the person asking — a 409 with the reason, not a generic 500.
    if (err instanceof Error && !("issues" in err) && !("code" in err)) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    return adminErrorResponse(err);
  }
}
