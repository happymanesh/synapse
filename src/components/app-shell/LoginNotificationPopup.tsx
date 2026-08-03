"use client";

import { useState } from "react";
import { formatDateTime } from "@/lib/report-format";
import { useLanguage } from "@/lib/i18n";
import { useNotifications } from "./notifications-context";

/** Shown once per app-shell mount (i.e. on login / a fresh page load) for unread deliveryPopup notifications. */
export default function LoginNotificationPopup() {
  const { t } = useLanguage();
  const { notifications, markRead } = useNotifications();
  const [dismissed, setDismissed] = useState(false);

  const pending = notifications.filter((n) => n.deliveryPopup && !n.read);
  if (dismissed || pending.length === 0) return null;

  function handleClose() {
    setDismissed(true);
    markRead(pending.map((n) => n.id));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4">
      <div className="flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-lg bg-card shadow-xl">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">{t("notifications")}</h2>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {pending.map((n) => (
            <div key={n.id} className="rounded-md border border-border bg-surface p-3">
              <p className="text-sm text-foreground/90">{n.messageText}</p>
              <p className="mt-1 text-xs text-foreground/50">{formatDateTime(n.createdAt)}</p>
            </div>
          ))}
        </div>
        <div className="border-t border-border p-3">
          <button
            type="button"
            onClick={handleClose}
            className="w-full rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground/70 hover:bg-surface hover:text-foreground"
          >
            {t("close")}
          </button>
        </div>
      </div>
    </div>
  );
}
