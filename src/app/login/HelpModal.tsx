"use client";

import { useState } from "react";

type SubFlow = "forgot-userid" | "reset-password";

export default function HelpModal({ onClose }: { onClose: () => void }) {
  const [flow, setFlow] = useState<SubFlow>("forgot-userid");
  const [username, setUsername] = useState("");
  const [contact, setContact] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setResult(null);
    try {
      const endpoint = flow === "forgot-userid" ? "/api/auth/forgot-userid" : "/api/auth/reset-password";
      const payload = flow === "forgot-userid" ? { contact } : { username, contact };
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      setResult({ ok: res.ok, message: res.ok ? data.message : (data.error ?? "Something went wrong.") });
    } catch {
      setResult({ ok: false, message: "Something went wrong. Please try again." });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4">
      <div className="w-full max-w-sm rounded-lg bg-card p-6 shadow-xl">
        <div className="flex items-start justify-between">
          <h3 className="text-lg font-semibold text-foreground">Need help signing in?</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground/70 hover:bg-surface hover:text-foreground"
          >
            Close
          </button>
        </div>

        <div className="mt-4 flex gap-1 rounded-lg bg-surface p-1">
          <button
            type="button"
            onClick={() => {
              setFlow("forgot-userid");
              setResult(null);
            }}
            className={[
              "flex-1 rounded-md px-3 py-2 text-xs font-medium transition-colors",
              flow === "forgot-userid" ? "bg-card text-foreground shadow-sm" : "text-foreground/60",
            ].join(" ")}
          >
            Forgot User ID
          </button>
          <button
            type="button"
            onClick={() => {
              setFlow("reset-password");
              setResult(null);
            }}
            className={[
              "flex-1 rounded-md px-3 py-2 text-xs font-medium transition-colors",
              flow === "reset-password" ? "bg-card text-foreground shadow-sm" : "text-foreground/60",
            ].join(" ")}
          >
            Reset Password
          </button>
        </div>

        {result ? (
          <p className={`mt-4 text-sm ${result.ok ? "text-brand-teal" : "text-danger"}`}>{result.message}</p>
        ) : (
          <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
            {flow === "reset-password" && (
              <div>
                <label htmlFor="help-username" className="mb-1 block text-xs font-medium text-foreground/80">
                  Username
                </label>
                <input
                  id="help-username"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:border-brand-navy focus:ring-1 focus:ring-brand-navy"
                />
              </div>
            )}
            <div>
              <label htmlFor="help-contact" className="mb-1 block text-xs font-medium text-foreground/80">
                Registered email or mobile number
              </label>
              <input
                id="help-contact"
                required
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:border-brand-navy focus:ring-1 focus:ring-brand-navy"
              />
            </div>
            <p className="text-xs text-foreground/50">
              Email/SMS delivery isn&apos;t live yet — your request will be queued for an
              administrator to assist you directly.
            </p>
            <button
              type="submit"
              disabled={submitting}
              className="btn-brand mt-1 rounded-md px-4 py-2 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {submitting ? "Submitting…" : "Submit request"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
