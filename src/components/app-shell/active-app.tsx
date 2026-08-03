"use client";

import { createContext, useContext } from "react";

/**
 * The app code the shell is currently showing. Client pages use this to scope their own
 * data fetches (e.g. the dashboard's favorites) without each one re-resolving the
 * user -> roles -> menus -> apps chain server-side.
 */
const ActiveAppContext = createContext<string | null>(null);

export function ActiveAppProvider({ code, children }: { code: string | null; children: React.ReactNode }) {
  return <ActiveAppContext.Provider value={code}>{children}</ActiveAppContext.Provider>;
}

export function useActiveAppCode(): string | null {
  return useContext(ActiveAppContext);
}
