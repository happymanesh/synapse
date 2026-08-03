"use client";

import { useEffect, useState } from "react";
import ReportRunner from "./ReportRunner";
import type { FilterItemView } from "./DynamicFilterField";
import { useLanguage } from "@/lib/i18n";

interface DefinitionView {
  reportId: string;
  reportTitle: string;
  mode: "REPORT" | "FORM";
  isCollapsible: boolean;
  defaultCollapsed: boolean;
  allowedFormats: string[];
  items: FilterItemView[];
}

interface ResultInfo {
  columns: number;
  rows: number;
}

// Explicit height (not just max-height) so the nested ReportRunner's flex-1/min-h-0
// scroll chain has a real box to measure against — otherwise the modal would only
// shrink-to-fit, and the "only the table scrolls, not the page" behavior would have
// nothing to constrain it.
const SIZE_CLASS: Record<"SMALL" | "MEDIUM" | "LARGE", string> = {
  SMALL: "max-w-md h-[55vh]",
  MEDIUM: "max-w-2xl h-[72vh]",
  LARGE: "max-w-5xl h-[88vh]",
};

/** Small/medium/large purely from how much the drilled-into report actually returned. */
function autoSizeClass(info: ResultInfo | null): string {
  if (!info) return SIZE_CLASS.MEDIUM;
  if (info.columns <= 3 && info.rows <= 10) return SIZE_CLASS.SMALL;
  if (info.columns <= 6 && info.rows <= 30) return SIZE_CLASS.MEDIUM;
  return SIZE_CLASS.LARGE;
}

export default function DrillDownModal({
  reportId,
  initialValues,
  sizeOverride,
  onClose,
}: {
  reportId: string;
  initialValues: Record<string, string>;
  sizeOverride: string;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const [def, setDef] = useState<DefinitionView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resultInfo, setResultInfo] = useState<ResultInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/reports/${reportId}/definition`)
      .then(async (res) => {
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(data.error ?? "Unable to load this report.");
          return;
        }
        setDef(data);
      })
      .catch(() => {
        if (!cancelled) setError("Unable to load this report.");
      });
    return () => {
      cancelled = true;
    };
  }, [reportId]);

  const sizeClass =
    sizeOverride === "AUTO"
      ? autoSizeClass(resultInfo)
      : (SIZE_CLASS[sizeOverride as "SMALL" | "MEDIUM" | "LARGE"] ?? SIZE_CLASS.MEDIUM);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`flex w-full flex-col overflow-hidden rounded-lg bg-card shadow-xl ${sizeClass}`}>
        <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">{def?.reportTitle ?? "…"}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground/70 hover:bg-surface hover:text-foreground"
          >
            {t("close")}
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden p-4">
          {error && <p className="text-sm text-danger">{error}</p>}
          {!error && !def && <p className="text-sm text-foreground/60">{t("loading")}</p>}
          {def && (
            <ReportRunner
              reportId={def.reportId}
              reportTitle={def.reportTitle}
              mode={def.mode}
              isCollapsible={def.isCollapsible}
              defaultCollapsed={def.defaultCollapsed}
              items={def.items}
              allowedFormats={def.allowedFormats}
              initialValues={initialValues}
              autoShow
              onResultLoaded={setResultInfo}
              isEmbeddedInModal
            />
          )}
        </div>
      </div>
    </div>
  );
}
