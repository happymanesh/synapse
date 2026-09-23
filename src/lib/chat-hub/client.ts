import "server-only";

/**
 * Client for chat-hub's service API - the TopBar agent access point. See chat-hub's
 * README "Phase 2 design: agent access point inside Synapse" for the read/list design;
 * sendReply below is the reply capability added on top of it (2026-09-23) once both
 * this app and workPulse already had a verified identity to attach to a reply.
 *
 * Modelled on src/lib/mail/mailer.ts's shape: plain fetch, no SDK, a no-op fallback
 * that fails quietly (returns null/empty rather than throwing) when unconfigured, and a
 * hard timeout. A missing/unreachable chat-hub must not break the TopBar for anyone.
 */

export interface ChatHubConversationSummary {
  conversationId: string;
  appName: string;
  agentName: string;
  lastMessage: string;
  lastMessageAt: string;
  messageCount: number;
}

export interface ChatHubMessage {
  id: string;
  conversation_id: string;
  sender_type: "visitor" | "ai" | "agent";
  content: string;
  created_at: string;
}

export interface ChatHubTranscript {
  conversation: { id: string; status: string; requested_agent_id: string | null };
  messages: ChatHubMessage[];
}

interface ChatHubConfig {
  baseUrl: string | undefined;
  serviceSecret: string | undefined;
}

function chatHubConfig(): ChatHubConfig {
  return {
    baseUrl: process.env.CHAT_HUB_BASE_URL,
    serviceSecret: process.env.CHAT_HUB_SERVICE_SECRET,
  };
}

async function serviceFetch(path: string, init: RequestInit = {}): Promise<Response | null> {
  const { baseUrl, serviceSecret } = chatHubConfig();
  if (!baseUrl || !serviceSecret) {
    console.info(`[chat-hub] not configured (CHAT_HUB_BASE_URL/CHAT_HUB_SERVICE_SECRET unset), skipping ${path}`);
    return null;
  }

  const signal = AbortSignal.timeout(8_000);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${serviceSecret}` },
      signal,
    });
    if (!response.ok) {
      console.error(`[chat-hub] ${path} -> HTTP ${response.status}`);
      return null;
    }
    return response;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`[chat-hub] ${path} failed: ${reason}`);
    return null;
  }
}

/** Every targeted conversation waiting for this Synapse username, across every chat-hub app they're linked to. */
export async function getAgentConversations(username: string): Promise<ChatHubConversationSummary[]> {
  const response = await serviceFetch(`/api/service/agents/${encodeURIComponent(username)}/conversations`);
  if (!response) return [];
  const data = await response.json();
  return data.conversations ?? [];
}

/** Read-only transcript for one conversation. Caller must verify ownership first - this itself doesn't check who's asking. */
export async function getConversationTranscript(conversationId: string): Promise<ChatHubTranscript | null> {
  const response = await serviceFetch(`/api/service/conversations/${encodeURIComponent(conversationId)}`);
  if (!response) return null;
  return response.json();
}

/**
 * Sends a reply as `username`. chat-hub itself verifies that username is actually the
 * agent this conversation is targeted at (its own ownership check, separate from ours
 * above) - a caller can't reply as someone else's conversation just by holding the
 * shared secret. Returns null on any failure (unconfigured, network, not-owned, etc.) -
 * the caller decides what to show the user, this layer doesn't distinguish why.
 */
export async function sendReply(conversationId: string, username: string, content: string): Promise<ChatHubMessage | null> {
  const response = await serviceFetch(`/api/service/conversations/${encodeURIComponent(conversationId)}/reply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ synapseUsername: username, content }),
  });
  if (!response) return null;
  const data = await response.json();
  return data.message ?? null;
}
