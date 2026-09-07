import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { canDecideChangeRequests } from "@/lib/auth";
import { decideChangeRequestSchema } from "@/lib/support-schemas";
import { decideChangeRequest } from "@/lib/change-requests";
import { adminErrorResponse } from "@/lib/admin-crud";

/**
 * Product/Ops approves or rejects (§4.6).
 *
 * The authority check here is a ROLE, not a menu grant — that is the whole substance of the
 * gate. Holding the Change Requests menu lets the desk see and propose; only Product/Ops (or
 * an administrator) can decide. Enforced server-side, because a hidden button is not an
 * access control.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  if (!(await canDecideChangeRequests(session.userUid))) {
    return NextResponse.json(
      { error: "Only Product/Ops can approve or reject a change request." },
      { status: 403 }
    );
  }

  const { id } = await context.params;
  const crId = Number(id);
  if (!Number.isInteger(crId)) {
    return NextResponse.json({ error: "Unknown change request." }, { status: 400 });
  }

  try {
    const body = decideChangeRequestSchema.parse(await request.json());
    const result = await decideChangeRequest(crId, body, { uid: session.userUid, username: session.username });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof Error && !("issues" in err) && !("code" in err)) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    return adminErrorResponse(err);
  }
}
