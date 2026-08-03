"use client";

import { createContext, useContext, type ReactNode } from "react";

interface AdminRowActionsContextValue {
  currentUsername: string;
  componentOptions?: { value: string; label: string }[];
  reportOptions?: { value: string; label: string }[];
}

const AdminRowActionsContext = createContext<AdminRowActionsContextValue | null>(null);

export function AdminRowActionsProvider({ value, children }: { value: AdminRowActionsContextValue; children: ReactNode }) {
  return <AdminRowActionsContext.Provider value={value}>{children}</AdminRowActionsContext.Provider>;
}

export function useAdminRowActionsContext(): AdminRowActionsContextValue {
  const ctx = useContext(AdminRowActionsContext);
  if (!ctx) {
    throw new Error("useAdminRowActionsContext must be used within AdminRowActionsProvider");
  }
  return ctx;
}
