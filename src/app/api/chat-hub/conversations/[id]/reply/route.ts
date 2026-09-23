import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getAgentConversations, sendReply } from "@/lib/chat-hub/client";

// Same ownership check as GET conversations/[id] - re-verify this conversation is
// actually targeted at the signed-in user before letting them reply to it, since
// chat-hub's own ownership check happens after this call, not instead of it.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const { id } = await params;
  const { content } = await req.json();

  if (typeof content !== "string" || !content.trim()) {
    return NextResponse.json({ error: "content required" }, { status: 400 });
  }

  const owned = await getAgentConversations(session.username);
  if (!owned.some((c) => c.conversationId === id)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const message = await sendReply(id, session.username, content.trim());
  if (!message) {
    return NextResponse.json({ error: "Could not send reply." }, { status: 502 });
  }

  return NextResponse.json({ message });
}
