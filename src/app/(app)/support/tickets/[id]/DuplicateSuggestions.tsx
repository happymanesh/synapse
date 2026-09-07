"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export interface Candidate {
  id: number;
  ticketNo: string;
  subject: string;
  raisedAt: string;
  status: string;
}

/**
 * Likely duplicates surfaced while staff answer a ticket (§4.4).
 *
 * Suggestions only — merging requires ticking the confirmation box, which the API also
 * demands, so a stray click can never combine two threads. Matching is deterministic (same
 * category, same entity, inside the rolling window), which is why the reason can be stated
 * plainly to the person deciding.
 */
export default function DuplicateSuggestions({
  ticketId,
  ticketNo,
  candidates,
}: {
  ticketId: number;
  ticketNo: string;
  candidates: Candidate[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<number | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function merge() {
    if (selected === null) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/tickets/${ticketId}/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ absorbedTicketId: selected, confirmed: true }),
      });
      if (res.redirected || !res.headers.get("content-type")?.includes("application/json")) {
        setError("Your session has expired. Please sign in again.");
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not merge these tickets.");
        return;
      }
      setSelected(null);
      setConfirmed(false);
      router.refresh();
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="rounded-lg border border-warning-border bg-warning-surface p-5">
      <h2 className="text-sm font-semibold text-foreground">
        Possible duplicates ({candidates.length})
      </h2>
      <p className="mt-1 text-xs text-foreground/70">
        Same category and same person, raised close together. Merging combines both histories into {ticketNo}; the
        other ticket stops being tracked separately and the turnaround clock keeps the earlier start time.
      </p>

      {error && <div className="mt-3 rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{error}</div>}

      <ul className="mt-3 space-y-2">
        {candidates.map((c) => (
          <li key={c.id}>
            <label className="flex cursor-pointer items-start gap-3 rounded-md border border-border bg-card p-3">
              <input
                type="radio"
                name="duplicate"
                className="mt-1 h-4 w-4"
                checked={selected === c.id}
                onChange={() => {
                  setSelected(c.id);
                  setConfirmed(false);
                }}
              />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline gap-2">
                  <Link
                    href={`/support/tickets/${c.id}`}
                    className="font-mono text-xs font-semibold text-link hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {c.ticketNo}
                  </Link>
                  <span className="text-xs text-foreground/55">
                    {c.raisedAt} · {c.status.replace(/_/g, " ").toLowerCase()}
                  </span>
                </span>
                <span className="mt-0.5 block text-sm text-foreground/85">{c.subject}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>

      {selected !== null && (
        <div className="mt-4 rounded-md border border-border bg-card p-3">
          <label className="flex items-start gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            <span>
              I&apos;ve checked these are the same issue. This can&apos;t be undone from here.
            </span>
          </label>
          <button
            type="button"
            onClick={merge}
            disabled={!confirmed || submitting}
            className="btn-brand mt-3 rounded-md px-4 py-2 text-sm font-semibold hover:opacity-90 disabled:opacity-60"
          >
            {submitting ? "Merging…" : "Merge into this ticket"}
          </button>
        </div>
      )}
    </section>
  );
}
