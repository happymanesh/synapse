import { NextRequest, NextResponse } from "next/server";
import { guardMenu } from "@/lib/api-guard";
import { ticketActionSchema, SUPPORT_MENU } from "@/lib/support-schemas";
import { applyTicketAction, type TicketAction } from "@/lib/tickets";
import { adminErrorResponse } from "@/lib/admin-crud";

const DENIED = "Only the support desk can act on tickets.";

/**
 * One route for every §4.5 staff action, because each is the same shape underneath: mutate
 * the ticket and append an audit event in the same transaction.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { session, error } = await guardMenu(SUPPORT_MENU.QUEUE, DENIED);
  if (error) return error;

  const { id } = await context.params;
  const ticketId = Number(id);
  if (!Number.isInteger(ticketId)) {
    return NextResponse.json({ error: "Unknown ticket." }, { status: 400 });
  }

  try {
    const action = ticketActionSchema.parse(await request.json());
    await applyTicketAction(ticketId, action as TicketAction, {
      uid: session.userUid,
      username: session.username,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    // Rejected transitions and merged-ticket guards are deliberate, message-carrying errors
    // meant for the person clicking — surface them as 409 rather than a generic 500.
    if (err instanceof Error && !("issues" in err) && !("code" in err)) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    return adminErrorResponse(err);
  }
}
