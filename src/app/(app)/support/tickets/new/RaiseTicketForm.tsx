"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CHANNELS, NEW_OPTION_SENTINEL } from "@/lib/ticket-schemas";
import { TICKET_TYPES, TICKET_TYPE_LABELS } from "@/lib/ticket-core";
import { ALLOWED_EXTENSIONS, MAX_FILES_PER_TICKET, MAX_FILE_BYTES, formatBytes } from "@/lib/attachment-core";

export interface MasterOption {
  id: number;
  name: string;
}

interface Created {
  ticketNo: string;
  raiserType: string;
  ambiguous: boolean;
  notificationQueued: boolean;
  attachmentsSaved?: number;
  attachmentErrors?: string[];
}

const INPUT =
  "w-full rounded-md border bg-card px-3 py-2 text-sm outline-none focus:ring-1 focus:border-brand-navy focus:ring-brand-navy";

export default function RaiseTicketForm({
  applications,
  segments,
  canLogForOthers,
  raisedAtLabel,
}: {
  applications: MasterOption[];
  segments: MasterOption[];
  canLogForOthers: boolean;
  /** Rendered on the server so the timestamp shown matches the server clock the ticket will
   * actually be stamped with, rather than whatever the browser thinks the time is. */
  raisedAtLabel: string;
}) {
  const router = useRouter();
  const [forSomeoneElse, setForSomeoneElse] = useState(false);
  const [ticketType, setTicketType] = useState<string>("ISSUE");
  const [applicationId, setApplicationId] = useState<string>("");
  const [segmentId, setSegmentId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [created, setCreated] = useState<Created | null>(null);
  const [files, setFiles] = useState<File[]>([]);

  const borderFor = (field: string) => (fieldErrors[field] ? "border-danger" : "border-border");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setFieldErrors({});

    const form = new FormData(event.currentTarget);
    const payload = {
      ticketType,
      typeOther: form.get("typeOther"),
      applicationId,
      applicationNew: form.get("applicationNew"),
      segmentId,
      segmentNew: form.get("segmentNew"),
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
      let attachmentsSaved = 0;
      let attachmentErrors: string[] = [];
      if (files.length > 0) {
        // Uploaded after creation because an attachment hangs off a ticket id, which does
        // not exist until the ticket does. A failure here must not discard the ticket.
        const fd = new FormData();
        for (const f of files) fd.append("files", f);
        try {
          const up = await fetch(`/api/tickets/${data.id}/attachments`, { method: "POST", body: fd });
          const upBody = await up.json().catch(() => ({}));
          attachmentsSaved = (upBody.saved ?? []).length;
          attachmentErrors = upBody.rejected ?? (up.ok ? [] : [upBody.error ?? "Attachments could not be uploaded."]);
        } catch {
          attachmentErrors = ["The ticket was raised, but the attachments could not be uploaded."];
        }
      }

      setCreated({ ...data, attachmentsSaved, attachmentErrors });
      setFiles([]);
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
        {created.attachmentsSaved !== undefined && created.attachmentsSaved > 0 && (
          <p className="mt-3 text-sm text-foreground/70">
            {created.attachmentsSaved} attachment{created.attachmentsSaved === 1 ? "" : "s"} uploaded.
          </p>
        )}
        {created.attachmentErrors && created.attachmentErrors.length > 0 && (
          <div className="mt-3 rounded-md border border-warning-border bg-warning-surface p-3 text-sm text-foreground/80">
            <p className="font-medium">The ticket was raised, but some files were not attached:</p>
            <ul className="mt-1 list-disc pl-5">
              {created.attachmentErrors.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </div>
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
        {/* Three independent axes rather than one combined list: a flat product-x-type
            catalogue grows multiplicatively and still cannot express segment. */}
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">
              Type <span className="text-danger">*</span>
            </label>
            <select
              value={ticketType}
              onChange={(e) => setTicketType(e.target.value)}
              className={`${INPUT} ${borderFor("ticketType")}`}
            >
              {TICKET_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TICKET_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
            {fieldErrors.ticketType && <p className="mt-1 text-xs text-danger">{fieldErrors.ticketType}</p>}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">
              Application <span className="text-danger">*</span>
            </label>
            <select
              value={applicationId}
              onChange={(e) => setApplicationId(e.target.value)}
              className={`${INPUT} ${borderFor("applicationId")}`}
            >
              <option value="" disabled>
                Select…
              </option>
              {applications.map((a) => (
                <option key={a.id} value={String(a.id)}>
                  {a.name}
                </option>
              ))}
              <option value={NEW_OPTION_SENTINEL}>+ Add a new application…</option>
            </select>
            {fieldErrors.applicationId && <p className="mt-1 text-xs text-danger">{fieldErrors.applicationId}</p>}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">
              Segment <span className="text-danger">*</span>
            </label>
            <select
              value={segmentId}
              onChange={(e) => setSegmentId(e.target.value)}
              className={`${INPUT} ${borderFor("segmentId")}`}
            >
              <option value="" disabled>
                Select…
              </option>
              {segments.map((sg) => (
                <option key={sg.id} value={String(sg.id)}>
                  {sg.name}
                </option>
              ))}
              <option value={NEW_OPTION_SENTINEL}>+ Add a new segment…</option>
            </select>
            {fieldErrors.segmentId && <p className="mt-1 text-xs text-danger">{fieldErrors.segmentId}</p>}
          </div>
        </div>

        {/* Revealed conditionally, so the common path stays three dropdowns. */}
        {ticketType === "OTHERS" && (
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">
              Please mention the type <span className="text-danger">*</span>
            </label>
            <input name="typeOther" maxLength={120} className={`${INPUT} ${borderFor("typeOther")}`} />
            {fieldErrors.typeOther && <p className="mt-1 text-xs text-danger">{fieldErrors.typeOther}</p>}
          </div>
        )}

        {applicationId === NEW_OPTION_SENTINEL && (
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">
              New application name <span className="text-danger">*</span>
            </label>
            <input name="applicationNew" maxLength={120} className={`${INPUT} ${borderFor("applicationNew")}`} />
            {fieldErrors.applicationNew && <p className="mt-1 text-xs text-danger">{fieldErrors.applicationNew}</p>}
            <p className="mt-1 text-xs text-foreground/60">Added to the list for everyone once saved.</p>
          </div>
        )}

        {segmentId === NEW_OPTION_SENTINEL && (
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">
              New segment name <span className="text-danger">*</span>
            </label>
            <input name="segmentNew" maxLength={120} className={`${INPUT} ${borderFor("segmentNew")}`} />
            {fieldErrors.segmentNew && <p className="mt-1 text-xs text-danger">{fieldErrors.segmentNew}</p>}
            <p className="mt-1 text-xs text-foreground/60">Added to the list for everyone once saved.</p>
          </div>
        )}

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

      <div className="mt-4">
        <label className="mb-1 block text-sm font-medium text-foreground">Attachments</label>
        <input
          type="file"
          multiple
          accept={ALLOWED_EXTENSIONS.join(",")}
          onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-surface file:px-3 file:py-1 file:text-sm file:text-foreground/80"
        />
        <p className="mt-1 text-xs text-foreground/60">
          Up to {MAX_FILES_PER_TICKET} files, {formatBytes(MAX_FILE_BYTES)} each. Screenshots, PDFs, spreadsheets and
          documents.
        </p>
        {files.length > 0 && (
          <ul className="mt-2 space-y-1 text-xs text-foreground/70">
            {files.map((f) => (
              <li key={f.name + f.size} className="flex justify-between gap-3">
                <span className="truncate">{f.name}</span>
                <span className="shrink-0 text-foreground/50">{formatBytes(f.size)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-4 rounded-md border border-border bg-surface px-3 py-2 text-xs text-foreground/70">
        Raising at <span className="font-medium text-foreground">{raisedAtLabel}</span> — this is the timestamp the
        turnaround clock will start from.
      </div>

      <div className="mt-4 flex items-center gap-3">
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
