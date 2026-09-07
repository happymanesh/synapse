import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { canDecideChangeRequests } from "@/lib/auth";
import { backlogStatusSchema } from "@/lib/support-schemas";
import { updateBacklogStatus } from "@/lib/change-requests";
import { adminErrorResponse } from "@/lib/admin-crud";

/** Moves an approved item through the backlog. Same Product/Ops authority as the decision —
 * the backlog is theirs to run, not the desk's. */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  if (!(await canDecideChangeRequests(session.userUid))) {
    return NextResponse.json({ error: "Only Product/Ops can manage the backlog." }, { status: 403 });
  }

  const { id } = await context.params;
  const crId = Number(id);
  if (!Number.isInteger(crId)) {
    return NextResponse.json({ error: "Unknown change request." }, { status: 400 });
  }

  try {
    const body = backlogStatusSchema.parse(await request.json());
    const result = await updateBacklogStatus(crId, body, { uid: session.userUid, username: session.username });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof Error && !("issues" in err) && !("code" in err)) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    return adminErrorResponse(err);
  }
}
