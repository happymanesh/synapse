"use client";

import FilterItemsModal from "./FilterItemsModal";
import { useAdminRowActionsContext } from "./AdminRowActionsContext";

export default function FilterRowActions({ row }: { row: Record<string, unknown> }) {
  const { currentUsername, componentOptions } = useAdminRowActionsContext();
  return (
    <FilterItemsModal filterId={String(row.filterId)} currentUsername={currentUsername} componentOptions={componentOptions ?? []} />
  );
}
