"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const INPUT =
  "w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:border-brand-navy focus:ring-1 focus:ring-brand-navy";

type Tab = "REMARK" | "STATUS" | "FORWARD" | "ETA";

const TABS: { kind: Tab; label: string }[] = [
  { kind: "REMARK", label: "Add remark" },
  { kind: "STATUS", label: "Change status" },
  { kind: "FORWARD", label: "Forward" },
  { kind: "ETA", label: "Revise ETA" },
];

export default function TicketActions({
  ticketId,
  currentStatus,
  allowedStatuses,
  forwardTargets,
}: {
  ticketId: number;
  currentStatus: string;
  allowedStatuses: readonly string[];
  forwardTargets: { uid: number; name: string }[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("REMARK");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    const payload: Record<string, unknown> = { kind: tab, remarks: form.get("remarks") ?? "" };
    if (tab === "STATUS") payload.toStatus = form.get("toStatus");
    if (tab === "FORWARD") payload.toUserUid = form.get("toUserUid");
    if (tab === "ETA") payload.revisedEta = form.get("revisedEta");

    try {
      const res = await fetch(`/api/tickets/${ticketId}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.redirected || !res.headers.get("content-type")?.includes("application/json")) {
        setError("Your session has expired. Please sign in again.");
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not apply that.");
        return;
      }
      (event.target as HTMLFormElement).reset();
      router.refresh();
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold text-foreground">Update this ticket</h2>

      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.kind}
            type="button"
            onClick={() => {
              setTab(t.kind);
              setError(null);
            }}
            className={`rounded-md border px-3 py-1.5 text-sm font-medium ${
              tab === t.kind
                ? "border-brand-navy bg-surface text-foreground"
                : "border-border text-foreground/70 hover:bg-surface"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <div className="mb-3 rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{error}</div>}

      <form onSubmit={submit} className="space-y-3">
        {tab === "STATUS" && (
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">
              New status <span className="text-danger">*</span>
            </label>
            {allowedStatuses.length === 0 ? (
              <p className="text-sm text-foreground/60">This ticket can&apos;t move anywhere from {currentStatus}.</p>
            ) : (
              <select name="toStatus" className={INPUT} defaultValue="">
                <option value="" disabled>
                  Select…
                </option>
                {allowedStatuses.map((s) => (
                  <option key={s} value={s}>
                    {s.replace(/_/g, " ").toLowerCase()}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        {tab === "FORWARD" && (
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">
              Forward to <span className="text-danger">*</span>
            </label>
            <select name="toUserUid" className={INPUT} defaultValue="">
              <option value="" disabled>
                Select a colleague…
              </option>
              {forwardTargets.map((u) => (
                <option key={u.uid} value={u.uid}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {tab === "ETA" && (
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">
              Revised ETA <span className="text-danger">*</span>
            </label>
            <input type="datetime-local" name="revisedEta" className={INPUT} />
          </div>
        )}

        <div>
          <label className="mb-1 block text-sm font-medium text-foreground">
            {tab === "FORWARD" ? (
              <>
                Why are you forwarding it? <span className="text-danger">*</span>
              </>
            ) : tab === "REMARK" ? (
              <>
                Remark <span className="text-danger">*</span>
              </>
            ) : (
              "Remark (optional)"
            )}
          </label>
          <textarea name="remarks" rows={3} maxLength={4000} className={INPUT} />
          {tab === "FORWARD" && (
            <p className="mt-1 text-xs text-foreground/60">
              Recorded in the ticket history, so the trail shows who, when and why.
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="btn-brand rounded-md px-4 py-2 text-sm font-semibold hover:opacity-90 disabled:opacity-60"
        >
          {submitting ? "Saving…" : "Save"}
        </button>
      </form>
    </section>
  );
}
