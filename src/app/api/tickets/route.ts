import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { createTicketSchema } from "@/lib/ticket-schemas";
import { canLogForOthers, createTicket } from "@/lib/tickets";
import { adminErrorResponse } from "@/lib/admin-crud";

/**
 * Ticket intake for the Synapse channel (§4.1). Website and WhatsApp intake will call
 * `createTicket` through their own entry points rather than reposting to this route, which
 * assumes a signed-in session.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  try {
    const body = createTicketSchema.parse(await request.json());

    // Enforced server-side, not merely hidden in the UI: logging a ticket against someone
    // else's identity is exactly the kind of thing a hidden field invites tampering with.
    if (body.forSomeoneElse && !(await canLogForOthers(session.userUid))) {
      return NextResponse.json(
        { error: "You can only raise tickets for yourself." },
        { status: 403 }
      );
    }

    const result = await createTicket({
      channel: body.forSomeoneElse ? body.channel : "SYNAPSE",
      categoryCode: body.categoryCode,
      subject: body.subject,
      description: body.description,
      companyCode: session.companyCode,
      createdByUsername: session.username,
      actorUid: session.userUid,
      raiser: body.forSomeoneElse
        ? {
            kind: "CONTACT",
            name: body.contactName,
            email: body.contactEmail,
            mobile: body.contactMobile,
            clientCode: body.contactClientCode,
          }
        : { kind: "SELF", uid: session.userUid, hierarchyCode: session.hierarchyCode },
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
