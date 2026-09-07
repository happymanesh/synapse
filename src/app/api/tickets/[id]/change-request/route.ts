import { NextRequest, NextResponse } from "next/server";
import { guardMenu } from "@/lib/api-guard";
import { proposeChangeRequestSchema, SUPPORT_MENU } from "@/lib/support-schemas";
import { proposeChangeRequest } from "@/lib/change-requests";
import { adminErrorResponse } from "@/lib/admin-crud";

/**
 * The support desk PROPOSES a change request (§4.6). Deliberately gated on the triage-queue
 * menu and nothing more — approving it needs the separate Product/Ops authority checked in
 * /api/change-requests/[id]/decision, which is what stops the desk parking its own work.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { session, error } = await guardMenu(SUPPORT_MENU.QUEUE, "Only the support desk can convert a ticket.");
  if (error) return error;

  const { id } = await context.params;
  const ticketId = Number(id);
  if (!Number.isInteger(ticketId)) {
    return NextResponse.json({ error: "Unknown ticket." }, { status: 400 });
  }

  try {
    const body = proposeChangeRequestSchema.parse(await request.json());
    const cr = await proposeChangeRequest(ticketId, body, { uid: session.userUid, username: session.username });
    return NextResponse.json(cr, { status: 201 });
  } catch (err) {
    if (err instanceof Error && !("issues" in err) && !("code" in err)) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    return adminErrorResponse(err);
  }
}
