"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import HelpModal from "./HelpModal";

type Tab = "userid" | "otp" | "qr";

const TABS: { key: Tab; label: string; disabled: boolean; disabledReason?: string }[] = [
  { key: "userid", label: "User ID", disabled: false },
  { key: "otp", label: "OTP", disabled: true, disabledReason: "Requires email/SMS service — coming soon" },
  { key: "qr", label: "QR Code", disabled: true, disabledReason: "Requires mobile app pairing — coming soon" },
];

export default function LoginPanel() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>("userid");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

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
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="w-full max-w-sm">
      <h2 className="text-2xl font-semibold text-foreground">Sign in</h2>
      <p className="mt-1 text-sm text-foreground/60">Access your SIHL Synapse account.</p>

      <div className="mt-6 flex gap-1 rounded-lg bg-surface p-1" role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.key}
            disabled={tab.disabled}
            title={tab.disabledReason}
            onClick={() => !tab.disabled && setActiveTab(tab.key)}
            className={[
              "flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              tab.disabled
                ? "cursor-not-allowed text-foreground/30"
                : activeTab === tab.key
                  ? "bg-card text-foreground shadow-sm"
                  : "text-foreground/60 hover:text-foreground",
            ].join(" ")}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab !== "userid" ? (
        <p className="mt-4 rounded-md border border-border bg-surface px-3 py-2 text-xs text-foreground/60">
          {TABS.find((t) => t.key === activeTab)?.disabledReason}
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
          <div>
            <label htmlFor="username" className="mb-1 block text-sm font-medium text-foreground/80">
              Username
            </label>
            <input
              id="username"
              name="username"
              autoComplete="username"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:border-brand-navy focus:ring-1 focus:ring-brand-navy"
            />
          </div>
          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium text-foreground/80">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:border-brand-navy focus:ring-1 focus:ring-brand-navy"
            />
          </div>

          {error && <p className="text-sm text-danger">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="btn-brand mt-2 rounded-md px-4 py-2 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {submitting ? "Signing in…" : "Sign in"}
          </button>

          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            className="text-center text-sm text-brand-navy hover:underline"
          >
            Need help?
          </button>
        </form>
      )}

      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}
    </div>
  );
}
