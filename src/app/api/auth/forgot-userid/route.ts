import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * Phase 1: capture-only. Real email/SMS delivery isn't live yet, so this just
 * queues the request for an admin to action manually.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const contact = typeof body?.contact === "string" ? body.contact.trim() : "";

  if (!contact) {
    return NextResponse.json(
      { error: "Please provide your registered email or mobile number." },
      { status: 400 }
    );
  }

  await prisma.accountRequest.create({
    data: { requestType: "FORGOT_USERID", contact },
  });

  return NextResponse.json({
    success: true,
    message: "Request received. An administrator will assist you shortly.",
  });
}
