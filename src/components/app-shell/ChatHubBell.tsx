"use client";

import { useEffect, useState } from "react";
import { formatDateTime } from "@/lib/report-format";
import { useLanguage } from "@/lib/i18n";
import type { ChatHubConversationSummary, ChatHubTranscript } from "@/lib/chat-hub/client";

/**
 * chat-hub's TopBar agent access point. Read-only by design: chat-hub has no reply
 * capability anywhere yet (that's its own phase 3), so this shows a transcript, not a
 * reply box. Structurally mirrors NotificationBell.tsx, but is self-contained (no shared
 * context) since nothing else on the page needs this data.
 */
export default function ChatHubBell() {
  const { t } = useLanguage();
  const [conversations, setConversations] = useState<ChatHubConversationSummary[]>([]);
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<ChatHubTranscript | null>(null);
  const [transcriptLoading, setTranscriptLoading] = useState(false);

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
    setTranscript(null);
    setTranscriptLoading(true);
    fetch(`/api/chat-hub/conversations/${id}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: ChatHubTranscript | null) => setTranscript(data))
      .catch(() => setTranscript(null))
      .finally(() => setTranscriptLoading(false));
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
            className="max-h-[80vh] w-full max-w-md overflow-hidden rounded-lg border border-chrome-border bg-chrome-background shadow-xl"
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
            <div className="max-h-[60vh] overflow-y-auto p-4">
              {transcriptLoading && <p className="text-sm text-chrome-foreground/50">{t("loading")}</p>}
              {!transcriptLoading && !transcript && (
                <p className="text-sm text-chrome-foreground/50">{t("somethingWentWrong")}</p>
              )}
              {transcript?.messages.map((m) => (
                <div key={m.id} className="mb-3 last:mb-0">
                  <p className="text-xs font-semibold text-chrome-foreground/60">
                    {m.sender_type === "visitor" ? "Visitor" : m.sender_type}
                  </p>
                  <p className="mt-0.5 text-sm whitespace-pre-wrap text-chrome-foreground/90">{m.content}</p>
                  <p className="mt-0.5 text-xs text-chrome-foreground/40">{formatDateTime(m.created_at)}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
