import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getAgentConversations, getConversationTranscript } from "@/lib/chat-hub/client";

// chat-hub's own service endpoint trusts whoever holds the service secret and doesn't
// check per-agent ownership - it's Synapse's job to enforce that a user can only open
// transcripts for conversations actually targeted at them, same as any other record
// this app serves. Re-fetching the agent's conversation list to check membership costs
// one extra round trip but keeps the ownership check server-side and impossible to skip.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const { id } = await params;

  const owned = await getAgentConversations(session.username);
  if (!owned.some((c) => c.conversationId === id)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const transcript = await getConversationTranscript(id);
  if (!transcript) {
    return NextResponse.json({ error: "Could not load conversation." }, { status: 502 });
  }

  return NextResponse.json(transcript);
}
