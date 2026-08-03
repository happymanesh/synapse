"use client";

import { useState } from "react";
import { formatDateTime } from "@/lib/report-format";
import { useLanguage } from "@/lib/i18n";
import { useNotifications } from "./notifications-context";

export default function NotificationBell() {
  const { t } = useLanguage();
  const { notifications, markRead } = useNotifications();
  const [open, setOpen] = useState(false);

  const bellItems = notifications.filter((n) => n.deliveryBell);
  const unreadCount = bellItems.filter((n) => !n.read).length;

  function handleOpen() {
    const wasOpen = open;
    setOpen(!wasOpen);
    if (wasOpen) return;
    markRead(bellItems.filter((n) => !n.read).map((n) => n.id));
  }

  return (
    <div className="relative">
      <button
        type="button"
        title={t("notifications")}
        onClick={handleOpen}
        className="relative rounded-full p-2 hover:bg-chrome-surface"
      >
        🔔
        {unreadCount > 0 && (
          <span className="absolute top-0 right-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-80 rounded-md border border-chrome-border bg-chrome-background shadow-lg">
          <div className="border-b border-chrome-border px-3 py-2 text-xs font-semibold text-chrome-foreground/60 uppercase">
            {t("notifications")}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {bellItems.length === 0 ? (
              <p className="px-3 py-4 text-center text-sm text-chrome-foreground/50">{t("noNotifications")}</p>
            ) : (
              bellItems.map((n) => (
                <div
                  key={n.id}
                  className={["border-b border-chrome-border px-3 py-2 last:border-b-0", n.read ? "" : "bg-chrome-surface"].join(" ")}
                >
                  <p className="text-sm text-chrome-foreground/90">{n.messageText}</p>
                  <p className="mt-1 text-xs text-chrome-foreground/50">{formatDateTime(n.createdAt)}</p>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
