"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "@/lib/i18n";

/**
 * Change your own password, from the profile menu.
 *
 * Deliberately does not enforce the password rules in the browser. The server owns them
 * (@/lib/password-policy) and reports one problem at a time; duplicating them here would
 * give two sets of wording that drift apart, and the client copy would be the one people
 * trust. The rules are *stated* below the fields so nobody has to discover them by failing.
 */
/**
 * `forced`: the first-login change (the /change-password page). No Close button, Escape does
 * nothing, and on success `onChanged` runs instead of showing a message — the caller moves on.
 */
export default function ChangePasswordModal({
  onClose,
  forced = false,
  onChanged,
}: {
  onClose: () => void;
  forced?: boolean;
  onChanged?: () => void;
}) {
  const { t } = useLanguage();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // The caller mounts this only while the dialog is open, so the fields start empty every
  // time without a reset: a password must not sit in React state behind a closed dialog.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !forced) onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, forced]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? t("somethingWentWrong"));
        return;
      }
      if (onChanged) {
        onChanged();
        return;
      }
      setSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch {
      setError(t("somethingWentWrong"));
    } finally {
      setSubmitting(false);
    }
  }

  const fieldClass =
    "w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-brand-navy focus:ring-1 focus:ring-brand-navy";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t("changePassword")}
    >
      <div className="w-full max-w-sm rounded-lg bg-card p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="text-lg font-semibold text-foreground">{t("changePassword")}</h3>
          {!forced && (
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground/70 hover:bg-surface hover:text-foreground"
          >
            {t("close")}
          </button>
          )}
        </div>
        {forced && (
          <p className="mb-3 text-sm text-foreground/70">
            This is your first sign-in. Replace the password you were given before continuing.
          </p>
        )}

        {success ? (
          <p className="text-sm text-brand-teal">
            {t("passwordUpdated")} Use the new password the next time you sign in.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <div>
              <label htmlFor="cp-current" className="mb-1 block text-xs font-medium text-foreground/80">
                Current password
              </label>
              <input
                id="cp-current"
                type="password"
                required
                autoFocus
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className={fieldClass}
              />
            </div>
            <div>
              <label htmlFor="cp-new" className="mb-1 block text-xs font-medium text-foreground/80">
                New password
              </label>
              <input
                id="cp-new"
                type="password"
                required
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className={fieldClass}
              />
            </div>
            <div>
              <label htmlFor="cp-confirm" className="mb-1 block text-xs font-medium text-foreground/80">
                Confirm new password
              </label>
              <input
                id="cp-confirm"
                type="password"
                required
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={fieldClass}
              />
            </div>
            <p className="text-xs text-foreground/50">
              Min 8 characters, one uppercase letter, one number, one special character, not the same as
              your username, and not one of the last 3 passwords used.
            </p>
            {error && <p className="text-sm text-danger">{error}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="btn-brand mt-1 rounded-md px-4 py-2 text-sm font-semibold hover:opacity-90 disabled:opacity-60"
            >
              {submitting ? t("saving") : t("update")}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
