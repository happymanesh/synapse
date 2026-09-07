"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CHANNELS } from "@/lib/ticket-schemas";

export interface CategoryOption {
  categoryCode: string;
  categoryName: string;
  productModule: string;
}

interface Created {
  ticketNo: string;
  raiserType: string;
  ambiguous: boolean;
  notificationQueued: boolean;
}

const INPUT =
  "w-full rounded-md border bg-card px-3 py-2 text-sm outline-none focus:ring-1 focus:border-brand-navy focus:ring-brand-navy";

export default function RaiseTicketForm({
  categories,
  canLogForOthers,
}: {
  categories: CategoryOption[];
  canLogForOthers: boolean;
}) {
  const router = useRouter();
  const [forSomeoneElse, setForSomeoneElse] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [created, setCreated] = useState<Created | null>(null);

  const borderFor = (field: string) => (fieldErrors[field] ? "border-danger" : "border-border");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setFieldErrors({});

    const form = new FormData(event.currentTarget);
    const payload = {
      categoryCode: form.get("categoryCode"),
      subject: form.get("subject"),
      description: form.get("description"),
      channel: forSomeoneElse ? form.get("channel") : "SYNAPSE",
      forSomeoneElse,
      contactName: form.get("contactName"),
      contactEmail: form.get("contactEmail"),
      contactMobile: form.get("contactMobile"),
      contactClientCode: form.get("contactClientCode"),
    };

    try {
      const res = await fetch("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      // An expired session is redirected to /login by proxy.ts before the route runs, so
      // what comes back is an HTML page, not JSON. Parsing it would throw and surface as a
      // generic network error, hiding the one thing the user needs to be told.
      if (res.redirected || !res.headers.get("content-type")?.includes("application/json")) {
        setError("Your session has expired. Please sign in again — your text is still here.");
        return;
      }

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not raise the ticket.");
        setFieldErrors(data.fieldErrors ?? {});
        return;
      }
      setCreated(data);
      // The list is a server component, so it needs a refresh to show the new row.
      router.refresh();
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (created) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-foreground">Ticket raised</h2>
        <p className="mt-2 text-sm text-foreground/80">
          Reference{" "}
          <span className="rounded bg-surface px-2 py-0.5 font-mono font-semibold text-foreground">
            {created.ticketNo}
          </span>
          . We aim to respond within 24 hours.
        </p>

        {created.ambiguous && (
          <p className="mt-3 rounded-md border border-warning-border bg-warning-surface p-3 text-sm text-foreground/80">
            The contact details matched more than one record, so this was logged as a guest ticket rather than
            attributed to the wrong person. Reconcile it from the triage queue.
          </p>
        )}
        {!created.notificationQueued && (
          <p className="mt-3 rounded-md border border-warning-border bg-warning-surface p-3 text-sm text-foreground/80">
            No email or mobile was captured, so no acknowledgement could be queued.
          </p>
        )}

        <div className="mt-5 flex gap-3">
          <button onClick={() => setCreated(null)} className="btn-brand rounded-md px-4 py-2 text-sm font-semibold hover:opacity-90">
            Raise another
          </button>
          <button
            onClick={() => router.push("/support/tickets")}
            className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground/80 hover:bg-surface"
          >
            View my tickets
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-border bg-card p-6 shadow-sm">
      {error && (
        <div className="mb-4 rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{error}</div>
      )}

      {canLogForOthers && (
        <div className="mb-5 rounded-md border border-border bg-surface p-3">
          <label className="flex items-center gap-2 text-sm font-medium text-foreground">
            <input
              type="checkbox"
              checked={forSomeoneElse}
              onChange={(e) => setForSomeoneElse(e.target.checked)}
              className="h-4 w-4"
            />
            I&apos;m logging this for someone who contacted us
          </label>
          <p className="mt-1 text-xs text-foreground/60">
            Use this for phone calls and messages. We&apos;ll try to match them to an existing record.
          </p>
        </div>
      )}

      {forSomeoneElse && (
        <div className="mb-5 grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm font-medium text-foreground">How did they reach us?</label>
            <select name="channel" defaultValue="PHONE" className={`${INPUT} border-border`}>
              {CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {c.charAt(0) + c.slice(1).toLowerCase()}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">
              Name <span className="text-danger">*</span>
            </label>
            <input name="contactName" className={`${INPUT} ${borderFor("contactName")}`} />
            {fieldErrors.contactName && <p className="mt-1 text-xs text-danger">{fieldErrors.contactName}</p>}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">Client code</label>
            <input name="contactClientCode" className={`${INPUT} ${borderFor("contactClientCode")}`} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">Email</label>
            <input name="contactEmail" className={`${INPUT} ${borderFor("contactEmail")}`} />
            {fieldErrors.contactEmail && <p className="mt-1 text-xs text-danger">{fieldErrors.contactEmail}</p>}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">Mobile</label>
            <input name="contactMobile" className={`${INPUT} ${borderFor("contactMobile")}`} />
          </div>
          <p className="text-xs text-foreground/60 sm:col-span-2">
            Contact details are optional — the ticket is created either way, and can be linked to a record later.
          </p>
        </div>
      )}

      <div className="grid gap-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-foreground">
            Category <span className="text-danger">*</span>
          </label>
          <select name="categoryCode" defaultValue="" className={`${INPUT} ${borderFor("categoryCode")}`}>
            <option value="" disabled>
              Select a category…
            </option>
            {categories.map((c) => (
              <option key={c.categoryCode} value={c.categoryCode}>
                {c.categoryName}
              </option>
            ))}
          </select>
          {fieldErrors.categoryCode && <p className="mt-1 text-xs text-danger">{fieldErrors.categoryCode}</p>}
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-foreground">
            Subject <span className="text-danger">*</span>
          </label>
          <input name="subject" maxLength={200} className={`${INPUT} ${borderFor("subject")}`} />
          {fieldErrors.subject && <p className="mt-1 text-xs text-danger">{fieldErrors.subject}</p>}
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-foreground">
            What went wrong? <span className="text-danger">*</span>
          </label>
          <textarea
            name="description"
            rows={5}
            maxLength={5000}
            className={`${INPUT} ${borderFor("description")}`}
          />
          {fieldErrors.description && <p className="mt-1 text-xs text-danger">{fieldErrors.description}</p>}
        </div>
      </div>

      <div className="mt-6 flex items-center gap-3">
        <button
          type="submit"
          disabled={submitting}
          className="btn-brand rounded-md px-4 py-2 text-sm font-semibold hover:opacity-90 disabled:opacity-60"
        >
          {submitting ? "Raising…" : "Raise ticket"}
        </button>
        <span className="text-xs text-foreground/60">We aim to respond within 24 hours.</span>
      </div>
    </form>
  );
}
