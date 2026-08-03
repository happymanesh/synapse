"use client";

import { createContext, useContext } from "react";

interface SidebarControlValue {
  /** Collapses the left menu — used by ReportRunner when Show is clicked. */
  collapseSidebar: () => void;
}

const SidebarControlContext = createContext<SidebarControlValue>({ collapseSidebar: () => {} });

export function SidebarControlProvider({ value, children }: { value: SidebarControlValue; children: React.ReactNode }) {
  return <SidebarControlContext.Provider value={value}>{children}</SidebarControlContext.Provider>;
}

export function useSidebarControl(): SidebarControlValue {
  return useContext(SidebarControlContext);
}
