"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useLanguage } from "@/lib/i18n";

export interface AppEntry {
  code: string;
  name: string;
  icon: string | null;
  logoUrl: string | null;
}

/** Nine-dot launcher glyph — the conventional "switch app" affordance. */
function AppsGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
      {[5, 12, 19].map((cy) => [5, 12, 19].map((cx) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="2" />))}
    </svg>
  );
}

function AppMark({ app, size }: { app: AppEntry; size: number }) {
  if (app.logoUrl) {
    return (
      <Image
        src={app.logoUrl}
        alt=""
        width={size}
        height={size}
        className="rounded-md object-contain"
        style={{ width: size, height: "auto" }}
      />
    );
  }
  if (app.icon) {
    return <span style={{ fontSize: size * 0.8, lineHeight: 1 }}>{app.icon}</span>;
  }
  return (
    <span
      className="flex items-center justify-center rounded-md bg-brand-navy font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.45 }}
    >
      {app.name.charAt(0).toUpperCase()}
    </span>
  );
}

export default function AppSwitcher({
  apps,
  activeAppCode,
  newWindow,
}: {
  apps: AppEntry[];
  activeAppCode: string | null;
  /** When the sidebar's "New window" toggle is on, picking an app opens it in a new tab instead of switching here. */
  newWindow: boolean;
}) {
  const router = useRouter();
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  async function selectApp(app: AppEntry) {
    if (busy) return;
    setBusy(true);
    try {
      // Persist first either way: "last opened app" is exactly what was just opened,
      // and a new tab has no other way to learn which app it should start in.
      await fetch("/api/apps/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appCode: app.code }),
      });
      setOpen(false);
      if (newWindow) {
        window.open("/dashboard", "_blank", "noopener,noreferrer");
      } else {
        // The menu tree is resolved server-side from lastAppCode, so the shell has to
        // re-render for the sidebar/search/favorites to follow the new app.
        router.push("/dashboard");
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        title={t("apps")}
        aria-label={t("apps")}
        onClick={() => setOpen((o) => !o)}
        className="rounded-full p-2 text-chrome-foreground/70 hover:bg-chrome-surface hover:text-chrome-foreground"
      >
        <AppsGlyph />
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-72 rounded-md border border-chrome-border bg-chrome-background p-2 shadow-lg">
          <p className="px-2 py-1 text-xs font-semibold text-chrome-foreground/50 uppercase">{t("apps")}</p>
          {apps.length === 0 ? (
            <p className="px-2 py-3 text-center text-sm text-chrome-foreground/50">{t("noApps")}</p>
          ) : (
            <div className="grid grid-cols-3 gap-1">
              {apps.map((app) => (
                <button
                  key={app.code}
                  type="button"
                  onClick={() => selectApp(app)}
                  disabled={busy}
                  title={app.name}
                  className={[
                    "flex flex-col items-center gap-1.5 rounded-md p-2 text-center hover:bg-chrome-surface disabled:opacity-50",
                    app.code === activeAppCode ? "bg-chrome-surface ring-1 ring-brand-navy/40" : "",
                  ].join(" ")}
                >
                  <AppMark app={app} size={32} />
                  <span className="w-full truncate text-xs text-chrome-foreground/80">{app.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
