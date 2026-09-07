import { NextRequest, NextResponse } from "next/server";
import { guardMenu } from "@/lib/api-guard";
import { reconcileTicketSchema, SUPPORT_MENU } from "@/lib/support-schemas";
import { reconcileTicketIdentity } from "@/lib/tickets";
import { adminErrorResponse } from "@/lib/admin-crud";

const DENIED = "Only the support desk can link a ticket to a person.";

/** Links a guest ticket to a master record (§4.2). */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { session, error } = await guardMenu(SUPPORT_MENU.QUEUE, DENIED);
  if (error) return error;

  const { id } = await context.params;
  const ticketId = Number(id);
  if (!Number.isInteger(ticketId)) {
    return NextResponse.json({ error: "Unknown ticket." }, { status: 400 });
  }

  try {
    const body = reconcileTicketSchema.parse(await request.json());
    const result = await reconcileTicketIdentity(ticketId, body.userUid, {
      uid: session.userUid,
      username: session.username,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof Error && !("issues" in err) && !("code" in err)) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    return adminErrorResponse(err);
  }
}
