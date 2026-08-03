"use client";

import { useState } from "react";
import { useLanguage } from "@/lib/i18n";

export default function ResetPasswordModal({ userUid, username }: { userUid: number; username: string }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function close() {
    setOpen(false);
    setPassword("");
    setError(null);
    setSuccess(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${userUid}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Unable to reset password.");
        return;
      }
      setSuccess(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Reset password"
        aria-label="Reset password"
        className="rounded-md p-1.5 text-base leading-none text-brand-navy hover:bg-surface"
      >
        🔑
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4">
          <div className="w-full max-w-sm rounded-lg bg-card p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-foreground">Reset password — {username}</h3>
              <button
                type="button"
                onClick={close}
                className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground/70 hover:bg-surface hover:text-foreground"
              >
                {t("close")}
              </button>
            </div>

            {success ? (
              <p className="text-sm text-brand-teal">{t("passwordUpdated")}</p>
            ) : (
              <form onSubmit={handleSubmit} className="flex flex-col gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-foreground/80">New password</label>
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:border-brand-navy focus:ring-1 focus:ring-brand-navy"
                  />
                </div>
                <p className="text-xs text-foreground/50">
                  Min 8 characters, one uppercase letter, one number, one special character, not the same as
                  the username, and not one of the last 3 passwords used.
                </p>
                {error && <p className="text-sm text-danger">{error}</p>}
                <button
                  type="submit"
                  disabled={submitting}
                  className="btn-brand mt-1 rounded-md px-4 py-2 text-sm font-semibold hover:opacity-90 disabled:opacity-60"
                >
                  {submitting ? t("saving") : t("save")}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
