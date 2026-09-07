import { NextRequest, NextResponse } from "next/server";
import { guardMenu } from "@/lib/api-guard";
import { mergeTicketsSchema, SUPPORT_MENU } from "@/lib/support-schemas";
import { mergeTickets } from "@/lib/tickets";
import { adminErrorResponse } from "@/lib/admin-crud";

const DENIED = "Only the support desk can merge tickets.";

/**
 * Merges another ticket into this one (§4.4). The ticket in the URL is the survivor — the
 * thread staff are looking at — and the body names the one being absorbed.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { session, error } = await guardMenu(SUPPORT_MENU.QUEUE, DENIED);
  if (error) return error;

  const { id } = await context.params;
  const survivorId = Number(id);
  if (!Number.isInteger(survivorId)) {
    return NextResponse.json({ error: "Unknown ticket." }, { status: 400 });
  }

  try {
    const body = mergeTicketsSchema.parse(await request.json());
    const result = await mergeTickets(survivorId, body.absorbedTicketId, {
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
