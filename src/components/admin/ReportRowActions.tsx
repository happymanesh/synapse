"use client";

import ReportColumnsModal from "./ReportColumnsModal";
import ReportHighlightRulesModal from "./ReportHighlightRulesModal";
import { useAdminRowActionsContext } from "./AdminRowActionsContext";

export default function ReportRowActions({ row }: { row: Record<string, unknown> }) {
  const { currentUsername, reportOptions } = useAdminRowActionsContext();
  const reportId = String(row.reportId);
  return (
    <div className="flex flex-wrap gap-2">
      <ReportColumnsModal reportId={reportId} currentUsername={currentUsername} reportOptions={reportOptions ?? []} />
      <ReportHighlightRulesModal reportId={reportId} currentUsername={currentUsername} />
    </div>
  );
}
