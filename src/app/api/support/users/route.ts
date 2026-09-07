import { NextRequest, NextResponse } from "next/server";
import { guardMenu } from "@/lib/api-guard";
import { SUPPORT_MENU } from "@/lib/support-schemas";
import { searchUsers } from "@/lib/tickets";

/**
 * People lookup for reconciling a guest ticket (§4.2).
 *
 * Scoped to the caller's own company and gated on the triage-queue menu, because this is a
 * directory of real people — it should not be readable by anyone who merely holds a session.
 */
export async function GET(request: NextRequest) {
  const { session, error } = await guardMenu(SUPPORT_MENU.QUEUE, "Only the support desk can look up people.");
  if (error) return error;

  const q = request.nextUrl.searchParams.get("q") ?? "";
  const users = await searchUsers(session.companyCode, q);
  return NextResponse.json(users);
}
