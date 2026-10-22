"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import HelpModal from "./HelpModal";

type Recovery = "forgot-userid" | "reset-password";

export default function LoginPanel() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [recovery, setRecovery] = useState<Recovery | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Unable to sign in.");
        return;
      }
      // First sign-in: the proxy would redirect anyway; go straight there.
      router.push(data.mustChangePassword ? "/change-password" : "/dashboard");
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const fieldClass =
    "w-full rounded-lg border border-border bg-card px-3.5 py-2.5 text-sm text-foreground " +
    "placeholder:text-foreground/35 outline-none transition-colors " +
    "focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/20";

  return (
    <div className="w-full max-w-sm">
      <h2 className="text-2xl font-semibold tracking-tight text-foreground">Sign in</h2>
      <p className="mt-1.5 text-sm text-foreground/55">Access your SIHL Synapse account.</p>

      <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-5" noValidate>
        <div>
          <label htmlFor="username" className="mb-1.5 block text-sm font-medium text-foreground/80">
            User ID
          </label>
          <input
            id="username"
            name="username"
            autoComplete="username"
            required
            autoFocus
            placeholder="e.g. SIHL-0720"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            aria-invalid={error ? true : undefined}
            className={fieldClass}
          />
        </div>

        <div>
          <div className="mb-1.5 flex items-baseline justify-between">
            <label htmlFor="password" className="block text-sm font-medium text-foreground/80">
              Password
            </label>
            <button
              type="button"
              onClick={() => setRecovery("reset-password")}
              className="text-xs font-medium text-link hover:underline"
            >
              Forgot password?
            </button>
          </div>
          <div className="relative">
            <input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={error ? true : undefined}
              className={`${fieldClass} pr-11`}
            />
            {/* The state is on the button (aria-label/aria-pressed), not conveyed by the
                glyph alone, so the control still works for a screen reader. */}
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-pressed={showPassword}
              title={showPassword ? "Hide password" : "Show password"}
              className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-foreground/45 transition-colors hover:text-foreground/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy/30"
            >
              <EyeIcon off={showPassword} />
            </button>
          </div>
        </div>

        {error && (
          <p role="alert" className="rounded-lg border border-danger/25 bg-danger/5 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="btn-brand mt-1 rounded-lg px-4 py-2.5 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <div className="mt-6 border-t border-border pt-4 text-center">
        <button
          type="button"
          onClick={() => setRecovery("forgot-userid")}
          className="text-sm text-link hover:underline"
        >
          Forgot your User ID?
        </button>
      </div>

      {recovery && <HelpModal initialFlow={recovery} onClose={() => setRecovery(null)} />}
    </div>
  );
}

/** Inline rather than an icon dependency — this is the only icon on the page. */
function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
      {off && <line x1="3" y1="3" x2="21" y2="21" />}
    </svg>
  );
}
