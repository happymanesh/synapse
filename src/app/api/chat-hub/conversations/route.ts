import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getAgentConversations } from "@/lib/chat-hub/client";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const conversations = await getAgentConversations(session.username);
  return NextResponse.json(conversations);
}
