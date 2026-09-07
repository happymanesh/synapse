"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DOCUMENT_TYPES, DOCUMENT_TYPE_LABELS, requiresClientCode } from "@/lib/document-core";

const INPUT =
  "w-full rounded-md border bg-card px-3 py-2 text-sm outline-none focus:border-brand-navy focus:ring-1 focus:ring-brand-navy";

interface Result {
  requestNo: string;
  status: string;
  deliverTo: string;
  cc: string | null;
  selfService: boolean;
  pendingReason: string | null;
}

export default function DocumentRequestForm({ isClient }: { isClient: boolean }) {
  const router = useRouter();
  const [documentType, setDocumentType] = useState<string>("LEDGER");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<Result | null>(null);

  const borderFor = (f: string) => (fieldErrors[f] ? "border-danger" : "border-border");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setFieldErrors({});

    const form = new FormData(event.currentTarget);
    try {
      const res = await fetch("/api/support/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentType,
          clientCode: form.get("clientCode"),
          fromDate: form.get("fromDate"),
          toDate: form.get("toDate"),
        }),
      });
      if (res.redirected || !res.headers.get("content-type")?.includes("application/json")) {
        setError("Your session has expired. Please sign in again.");
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not raise the request.");
        setFieldErrors(data.fieldErrors ?? {});
        return;
      }
      setResult(data);
      router.refresh();
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-foreground">Request recorded</h2>
        <p className="mt-2 text-sm text-foreground/80">
          Reference{" "}
          <span className="rounded bg-surface px-2 py-0.5 font-mono font-semibold text-foreground">
            {result.requestNo}
          </span>
        </p>
        <p className="mt-3 text-sm text-foreground/80">
          Will be sent to <span className="font-medium text-foreground">{result.deliverTo}</span>
          {result.cc && (
            <>
              , with <span className="font-medium text-foreground">{result.cc}</span> copied so the client can see a
              document was pulled on their account
            </>
          )}
          .
        </p>
        {result.pendingReason && (
          <p className="mt-3 rounded-md border border-warning-border bg-warning-surface p-3 text-sm text-foreground/80">
            {result.pendingReason}
          </p>
        )}
        <button
          onClick={() => setResult(null)}
          className="btn-brand mt-5 rounded-md px-4 py-2 text-sm font-semibold hover:opacity-90"
        >
          Request another
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="rounded-lg border border-border bg-card p-6 shadow-sm">
      {error && <div className="mb-4 rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{error}</div>}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="mb-1 block text-sm font-medium text-foreground">
            Document <span className="text-danger">*</span>
          </label>
          <select
            value={documentType}
            onChange={(e) => setDocumentType(e.target.value)}
            className={`${INPUT} border-border`}
          >
            {DOCUMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {DOCUMENT_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>

        {!isClient && (
          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm font-medium text-foreground">
              Client code {requiresClientCode(documentType) && <span className="text-danger">*</span>}
            </label>
            <input name="clientCode" className={`${INPUT} ${borderFor("clientCode")}`} />
            {fieldErrors.clientCode && <p className="mt-1 text-xs text-danger">{fieldErrors.clientCode}</p>}
            <p className="mt-1 text-xs text-foreground/60">
              The document goes to you, and the client is copied automatically.
            </p>
          </div>
        )}

        <div>
          <label className="mb-1 block text-sm font-medium text-foreground">From</label>
          <input type="date" name="fromDate" className={`${INPUT} border-border`} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-foreground">To</label>
          <input type="date" name="toDate" className={`${INPUT} border-border`} />
        </div>
      </div>

      <div className="mt-5 flex items-center gap-3">
        <button
          type="submit"
          disabled={submitting}
          className="btn-brand rounded-md px-4 py-2 text-sm font-semibold hover:opacity-90 disabled:opacity-60"
        >
          {submitting ? "Requesting…" : "Request document"}
        </button>
        <span className="text-xs text-foreground/60">
          {isClient
            ? "Sent to your registered email address."
            : "Delivery addresses come from master data, not from this form."}
        </span>
      </div>
    </form>
  );
}
