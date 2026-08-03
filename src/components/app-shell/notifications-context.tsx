"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

export interface NotificationEntry {
  id: number;
  messageText: string;
  createdAt: string;
  deliveryPopup: boolean;
  deliveryBell: boolean;
  read: boolean;
}

interface NotificationsValue {
  notifications: NotificationEntry[];
  /** Marks the given ids read optimistically, then persists. */
  markRead: (ids: number[]) => void;
}

const NotificationsContext = createContext<NotificationsValue>({ notifications: [], markRead: () => {} });

/**
 * Fetches /api/notifications ONCE per shell mount and shares it.
 *
 * The bell and the login popup render the same underlying list (the bell filters to
 * deliveryBell, the popup to unread deliveryPopup); fetching independently meant two
 * identical round trips on every page load, and two sources of truth for read state —
 * dismissing the popup left the bell's badge stale until a reload.
 */
export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const [notifications, setNotifications] = useState<NotificationEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/notifications")
      .then((res) => (res.ok ? res.json() : []))
      .then((data: NotificationEntry[]) => {
        if (!cancelled) setNotifications(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const markRead = useCallback((ids: number[]) => {
    if (ids.length === 0) return;
    setNotifications((prev) => prev.map((n) => (ids.includes(n.id) ? { ...n, read: true } : n)));
    fetch("/api/notifications/mark-read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    }).catch(() => {
      // Local state already updated optimistically — a failed mark-read just means these
      // come back unread on the next load, which is harmless.
    });
  }, []);

  return <NotificationsContext.Provider value={{ notifications, markRead }}>{children}</NotificationsContext.Provider>;
}

export function useNotifications(): NotificationsValue {
  return useContext(NotificationsContext);
}
