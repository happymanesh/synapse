"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BACKLOG_STATUSES } from "@/lib/ticket-core";

const INPUT =
  "w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:border-brand-navy focus:ring-1 focus:ring-brand-navy";

/**
 * Product/Ops decides (§4.6), and moves an approved item through the backlog.
 *
 * Rendered only for users who hold the authority — but the API checks the same role again,
 * because hiding a control is not an access control.
 */
export default function DecisionPanel({
  crId,
  approvalStatus,
  backlogStatus,
  targetRelease,
}: {
  crId: number;
  approvalStatus: string;
  backlogStatus: string | null;
  targetRelease: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remarks, setRemarks] = useState("");
  const [release, setRelease] = useState(targetRelease ?? "");

  async function post(url: string, body: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.redirected || !res.headers.get("content-type")?.includes("application/json")) {
        setError("Your session has expired. Please sign in again.");
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "That didn't work.");
        return;
      }
      setRemarks("");
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  if (approvalStatus === "PENDING") {
    return (
      <div className="mt-3 rounded-md border border-border bg-surface p-3">
        {error && <div className="mb-2 rounded-md border border-danger/40 bg-danger/10 p-2 text-xs text-danger">{error}</div>}
        <div className="grid gap-2 sm:grid-cols-2">
          <input
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="Decision remarks (optional)"
            className={INPUT}
          />
          <input
            value={release}
            onChange={(e) => setRelease(e.target.value)}
            placeholder="Target release, e.g. Q4 2026 (optional)"
            className={INPUT}
          />
        </div>
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              post(`/api/change-requests/${crId}/decision`, {
                decision: "APPROVED",
                remarks,
                targetRelease: release,
              })
            }
            className="btn-brand rounded-md px-4 py-2 text-sm font-semibold hover:opacity-90 disabled:opacity-60"
          >
            Approve &amp; park in backlog
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              post(`/api/change-requests/${crId}/decision`, { decision: "REJECTED", remarks, targetRelease: "" })
            }
            className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground/80 hover:bg-surface disabled:opacity-60"
          >
            Reject
          </button>
        </div>
        <p className="mt-2 text-xs text-foreground/60">
          Approving closes the originating ticket and queues a note to the raiser that it&apos;s being considered for
          a future release. Rejecting sends the ticket back to the desk.
        </p>
      </div>
    );
  }

  if (approvalStatus !== "APPROVED") return null;

  return (
    <div className="mt-3 rounded-md border border-border bg-surface p-3">
      {error && <div className="mb-2 rounded-md border border-danger/40 bg-danger/10 p-2 text-xs text-danger">{error}</div>}
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-foreground/60">
          Backlog status
          <select
            defaultValue={backlogStatus ?? "BACKLOG"}
            onChange={(e) =>
              post(`/api/change-requests/${crId}/backlog`, {
                backlogStatus: e.target.value,
                targetRelease: release,
              })
            }
            disabled={busy}
            className={`${INPUT} mt-1`}
          >
            {BACKLOG_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, " ").toLowerCase()}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
