"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface PersonOption {
  uid: number;
  fullName: string;
  username: string;
  email: string | null;
  mobile: string | null;
  isActive: boolean;
}

/**
 * Links a guest ticket to a master record (§4.2).
 *
 * `suggestions` are the records whose contact details match what intake captured. When a
 * ticket fell to guest *because* the contact matched several people, these are exactly those
 * people — so this panel offers precisely the choice the resolver refused to make alone.
 */
export default function ReconcilePanel({
  ticketId,
  suggestions,
  capturedAs,
}: {
  ticketId: number;
  suggestions: PersonOption[];
  capturedAs: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PersonOption[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search() {
    if (query.trim().length < 2) {
      setError("Type at least two characters to search.");
      return;
    }
    setSearching(true);
    setError(null);
    try {
      const res = await fetch(`/api/support/users?q=${encodeURIComponent(query)}`);
      if (!res.headers.get("content-type")?.includes("application/json")) {
        setError("Your session has expired. Please sign in again.");
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not search.");
        return;
      }
      setResults(data);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSearching(false);
    }
  }

  async function link() {
    if (selected === null) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/tickets/${ticketId}/reconcile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userUid: selected }),
      });
      if (res.redirected || !res.headers.get("content-type")?.includes("application/json")) {
        setError("Your session has expired. Please sign in again.");
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not link this ticket.");
        return;
      }
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSubmitting(false);
    }
  }

  const options = results ?? suggestions;

  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-foreground">Guest ticket — not linked to anyone</h2>
      <p className="mt-1 text-xs text-foreground/70">
        Intake captured: <span className="text-foreground/85">{capturedAs}</span>.{" "}
        {suggestions.length > 1
          ? "These contact details match more than one record, so it was left unlinked rather than attributed to the wrong person."
          : suggestions.length === 1
            ? "One record matches these details."
            : "No record matched these details — search for the right person below."}
      </p>

      {error && <div className="mt-3 rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{error}</div>}

      <div className="mt-4 flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              search();
            }
          }}
          placeholder="Search by name, user ID, email, mobile or client code"
          className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:border-brand-navy focus:ring-1 focus:ring-brand-navy"
        />
        <button
          type="button"
          onClick={search}
          disabled={searching}
          className="shrink-0 rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground/80 hover:bg-surface disabled:opacity-60"
        >
          {searching ? "…" : "Search"}
        </button>
      </div>

      {results !== null && (
        <button
          type="button"
          onClick={() => {
            setResults(null);
            setSelected(null);
          }}
          className="mt-2 text-xs text-link hover:underline"
        >
          ← Back to suggested matches
        </button>
      )}

      <ul className="mt-3 space-y-2">
        {options.length === 0 && (
          <li className="rounded-md border border-border bg-surface p-3 text-sm text-foreground/60">
            {results === null ? "No matching records." : "Nobody found for that search."}
          </li>
        )}
        {options.map((p) => (
          <li key={p.uid}>
            <label className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 hover:bg-surface/60">
              <input
                type="radio"
                name="person"
                className="mt-1 h-4 w-4"
                checked={selected === p.uid}
                onChange={() => setSelected(p.uid)}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-foreground">
                  {p.fullName}{" "}
                  <span className="font-normal text-foreground/50">({p.username})</span>
                  {!p.isActive && <span className="ml-2 text-xs text-foreground/50">inactive</span>}
                </span>
                <span className="block truncate text-xs text-foreground/60">
                  {[p.email, p.mobile].filter(Boolean).join(" · ") || "no contact on file"}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>

      {selected !== null && (
        <button
          type="button"
          onClick={link}
          disabled={submitting}
          className="btn-brand mt-4 rounded-md px-4 py-2 text-sm font-semibold hover:opacity-90 disabled:opacity-60"
        >
          {submitting ? "Linking…" : "Link this ticket to the selected person"}
        </button>
      )}
    </section>
  );
}
