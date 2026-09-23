"use client";

import { useEffect, useState } from "react";
import { formatDateTime } from "@/lib/report-format";
import { useLanguage } from "@/lib/i18n";
import { chatHubSupabase } from "@/lib/chat-hub/browser-client";
import type { ChatHubConversationSummary, ChatHubMessage, ChatHubTranscript } from "@/lib/chat-hub/client";

/**
 * chat-hub's TopBar agent access point. Now reply-capable (2026-09-23) - a reply is
 * sent via our own /api/chat-hub/conversations/:id/reply route (which re-checks
 * ownership before ever calling chat-hub), and the visitor's own follow-ups arrive live
 * via a direct Supabase Realtime subscription (see browser-client.ts for why this talks
 * to chat-hub's Supabase project directly rather than through chat-hub's API).
 */
export default function ChatHubBell() {
  const { t } = useLanguage();
  const [conversations, setConversations] = useState<ChatHubConversationSummary[]>([]);
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatHubMessage[]>([]);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [transcriptError, setTranscriptError] = useState(false);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/chat-hub/conversations")
      .then((res) => (res.ok ? res.json() : []))
      .then((data: ChatHubConversationSummary[]) => {
        if (!cancelled) setConversations(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  function openConversation(id: string) {
    setActiveId(id);
    setMessages([]);
    setTranscriptError(false);
    setTranscriptLoading(true);
    fetch(`/api/chat-hub/conversations/${id}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: ChatHubTranscript | null) => {
        if (data) setMessages(data.messages);
        else setTranscriptError(true);
      })
      .catch(() => setTranscriptError(true))
      .finally(() => setTranscriptLoading(false));
  }

  // Delivers the visitor's follow-up messages live while the modal is open. Our own
  // replies are skipped here - they're already added optimistically in sendReply()
  // below, and re-adding them from Realtime would just duplicate the bubble.
  useEffect(() => {
    if (!activeId) return;

    const channel = chatHubSupabase
      .channel(`messages:${activeId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${activeId}` },
        (payload) => {
          const incoming = payload.new as ChatHubMessage;
          if (incoming.sender_type === "agent") return;
          setMessages((prev) => (prev.some((m) => m.id === incoming.id) ? prev : [...prev, incoming]));
        }
      )
      .subscribe();

    return () => {
      chatHubSupabase.removeChannel(channel);
    };
  }, [activeId]);

  function sendReply() {
    const content = reply.trim();
    if (!content || !activeId || sending) return;

    setSending(true);
    setReply("");
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), conversation_id: activeId, sender_type: "agent", content, created_at: new Date().toISOString() },
    ]);

    fetch(`/api/chat-hub/conversations/${activeId}/reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    })
      .then((res) => {
        if (!res.ok) throw new Error();
      })
      .catch(() => setTranscriptError(true))
      .finally(() => setSending(false));
  }

  return (
    <div className="relative">
      <button
        type="button"
        title={t("chatRequests")}
        onClick={() => setOpen((o) => !o)}
        className="relative rounded-full p-2 hover:bg-chrome-surface"
      >
        💬
        {conversations.length > 0 && (
          <span className="absolute top-0 right-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">
            {conversations.length > 99 ? "99+" : conversations.length}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-2 w-80 rounded-md border border-chrome-border bg-chrome-background shadow-lg">
          <div className="border-b border-chrome-border px-3 py-2 text-xs font-semibold text-chrome-foreground/60 uppercase">
            {t("chatRequests")}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {conversations.length === 0 ? (
              <p className="px-3 py-4 text-center text-sm text-chrome-foreground/50">{t("noChatRequests")}</p>
            ) : (
              conversations.map((c) => (
                <button
                  key={c.conversationId}
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    openConversation(c.conversationId);
                  }}
                  className="block w-full border-b border-chrome-border px-3 py-2 text-left last:border-b-0 hover:bg-chrome-surface"
                >
                  <p className="text-xs font-semibold text-chrome-foreground/70">{c.appName}</p>
                  <p className="mt-0.5 truncate text-sm text-chrome-foreground/90">{c.lastMessage}</p>
                  <p className="mt-1 text-xs text-chrome-foreground/50">{formatDateTime(c.lastMessageAt)}</p>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {activeId && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40" onClick={() => setActiveId(null)}>
          <div
            className="flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-lg border border-chrome-border bg-chrome-background shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-chrome-border px-4 py-3">
              <span className="text-sm font-semibold text-chrome-foreground">{t("chatRequests")}</span>
              <button
                type="button"
                onClick={() => setActiveId(null)}
                className="rounded-full px-2 py-1 text-xs text-chrome-foreground/60 hover:bg-chrome-surface"
              >
                {t("close")}
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {transcriptLoading && <p className="text-sm text-chrome-foreground/50">{t("loading")}</p>}
              {!transcriptLoading && transcriptError && messages.length === 0 && (
                <p className="text-sm text-chrome-foreground/50">{t("somethingWentWrong")}</p>
              )}
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={["mb-3 last:mb-0 flex", m.sender_type === "agent" ? "justify-end" : "justify-start"].join(" ")}
                >
                  <div
                    className={[
                      "max-w-[80%] rounded-lg px-3 py-1.5",
                      m.sender_type === "agent" ? "bg-brand-navy text-white" : "bg-chrome-surface text-chrome-foreground",
                    ].join(" ")}
                  >
                    <p className="text-sm whitespace-pre-wrap">{m.content}</p>
                    <p className="mt-0.5 text-[10px] opacity-70">{formatDateTime(m.created_at)}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 border-t border-chrome-border p-3">
              <input
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendReply()}
                placeholder={t("typeAReply")}
                disabled={sending}
                className="flex-1 rounded-md border border-chrome-border bg-chrome-background px-3 py-1.5 text-sm text-chrome-foreground"
              />
              <button
                type="button"
                onClick={sendReply}
                disabled={sending || !reply.trim()}
                className="rounded-md bg-brand-navy px-3 py-1.5 text-sm text-white disabled:opacity-50"
              >
                {t("send")}
              </button>
            </div>
            {transcriptError && messages.length > 0 && (
              <p className="px-3 pb-2 text-xs text-danger">{t("replyFailed")}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
