"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const INPUT =
  "w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:border-brand-navy focus:ring-1 focus:ring-brand-navy";

/**
 * Puts a ticket forward as a change request (§4.6).
 *
 * Worded as a proposal throughout, because that is what it is: the desk cannot park work in
 * the backlog itself, and the ticket stays open until Product/Ops decides.
 */
export default function ProposeChangeRequest({
  ticketId,
  defaultTitle,
}: {
  ticketId: number;
  defaultTitle: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setFieldErrors({});

    const form = new FormData(event.currentTarget);
    try {
      const res = await fetch(`/api/tickets/${ticketId}/change-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: form.get("title"), description: form.get("description") }),
      });
      if (res.redirected || !res.headers.get("content-type")?.includes("application/json")) {
        setError("Your session has expired. Please sign in again.");
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not raise the change request.");
        setFieldErrors(data.fieldErrors ?? {});
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-foreground">Not a bug — a development request?</h2>
        <p className="mt-1 text-xs text-foreground/70">
          Put it forward as a change request. Product/Ops decides whether it goes to the backlog; the ticket stays
          open until they do.
        </p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-3 rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground/80 hover:bg-surface"
        >
          Propose a change request
        </button>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold text-foreground">Propose a change request</h2>
      {error && <div className="mb-3 rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{error}</div>}

      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-foreground">
            Title <span className="text-danger">*</span>
          </label>
          <input name="title" defaultValue={defaultTitle} maxLength={200} className={INPUT} />
          {fieldErrors.title && <p className="mt-1 text-xs text-danger">{fieldErrors.title}</p>}
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-foreground">
            What needs building, and why? <span className="text-danger">*</span>
          </label>
          <textarea name="description" rows={4} maxLength={5000} className={INPUT} />
          {fieldErrors.description && <p className="mt-1 text-xs text-danger">{fieldErrors.description}</p>}
          <p className="mt-1 text-xs text-foreground/60">This is what Product/Ops will decide on.</p>
        </div>
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={submitting}
            className="btn-brand rounded-md px-4 py-2 text-sm font-semibold hover:opacity-90 disabled:opacity-60"
          >
            {submitting ? "Submitting…" : "Submit for approval"}
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground/80 hover:bg-surface"
          >
            Cancel
          </button>
        </div>
      </form>
    </section>
  );
}
