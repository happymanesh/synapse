"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { formatDateTime } from "@/lib/report-format";

/**
 * Administration > HR Sync. One button fetches from the HR system and updates logins; the
 * panel polls while the job runs and shows what it did. All counts — no names except the new
 * accounts, which the admin must hand over in person (no email is sent).
 */

interface Logins {
  created: number;
  deactivated: number;
  suspended: number;
  unsuspended: number;
  lastWorkingDateSet: number;
  reviewsRaised: number;
  notAdded: Record<string, number>;
}
interface Summary {
  datesFetched: string[];
  fetched: number;
  newInHr: number;
  changed: number;
  resigned: number;
  rejected: number;
  logins: Logins;
}
export interface SyncJob {
  id: number;
  status: "RUNNING" | "SUCCEEDED" | "FAILED";
  phase: string | null;
  startedBy: string;
  startedAt: string;
  finishedAt: string | null;
  summary: Summary | null;
  error: string | null;
}
export interface CreatedUser {
  uid: number;
  username: string;
  fullName: string;
  employeeCode: string | null;
  department: string | null;
}

const POLL_MS = 2000;

function duration(job: SyncJob, now: number): string {
  const end = job.finishedAt ? new Date(job.finishedAt).getTime() : now;
  const s = Math.max(0, Math.round((end - new Date(job.startedAt).getTime()) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: "warn" | "good" }) {
  const color = tone === "warn" ? "text-danger" : tone === "good" ? "text-brand-teal" : "text-foreground";
  return (
    <div className="rounded-md border border-border bg-card px-4 py-3">
      <div className="text-xs text-foreground/60">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}

export default function HrSyncPanel({ initialJobs, initialCreated }: { initialJobs: SyncJob[]; initialCreated: CreatedUser[] }) {
  const [jobs, setJobs] = useState(initialJobs);
  const [created, setCreated] = useState(initialCreated);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const latest = jobs[0];
  const running = latest?.status === "RUNNING";

  const refresh = useCallback(async () => {
    const res = await fetch("/api/admin/hr-sync", { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as { jobs: SyncJob[]; createdUsers: CreatedUser[] };
    setJobs(data.jobs);
    setCreated(data.createdUsers);
  }, []);

  // Poll only while a job is running.
  useEffect(() => {
    if (!running) return;
    timer.current = setInterval(() => {
      setNow(Date.now());
      void refresh();
    }, POLL_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [running, refresh]);

  async function start() {
    setStarting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/hr-sync", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok && res.status !== 409) setError(data.error ?? "Could not start the sync.");
      if (res.status === 409) setError(data.error ?? "A sync is already running.");
      await refresh();
    } catch {
      setError("Could not start the sync.");
    } finally {
      setStarting(false);
    }
  }

  const s = latest?.summary;
  const notAdded = s ? Object.entries(s.logins.notAdded) : [];
  const notAddedTotal = notAdded.reduce((n, [, c]) => n + c, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={start}
          disabled={running || starting}
          className="btn-brand rounded-md px-4 py-2 text-sm font-semibold hover:opacity-90 disabled:opacity-60"
        >
          {running ? "Sync in progress…" : starting ? "Starting…" : "Sync from HR now"}
        </button>
        <p className="text-sm text-foreground/60">
          Fetches every change from the HR system since the last sync, then adds new employees and updates
          resignations (last working date, deactivation) and HR freezes. Nothing else on User Master is changed.
        </p>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}

      {latest && (
        <section className="rounded-lg border border-border bg-card p-5" aria-live="polite">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold text-foreground">
              {latest.status === "RUNNING" && (
                <>In progress — {latest.phase === "APPLYING" ? "updating logins" : "fetching from HR"}…</>
              )}
              {latest.status === "SUCCEEDED" && <>Completed</>}
              {latest.status === "FAILED" && <span className="text-danger">Failed</span>}
            </h2>
            <span className="text-xs text-foreground/60">
              Run #{latest.id} by {latest.startedBy}, started {formatDateTime(latest.startedAt)}
              {latest.finishedAt ? `, finished ${formatDateTime(latest.finishedAt)}` : ""} ({duration(latest, now)})
            </span>
          </div>

          {latest.error && <p className="mb-4 text-sm text-danger">{latest.error}</p>}

          {s && (
            <>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground/60">From HR</h3>
              <div className="mb-1 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Records fetched" value={s.fetched} />
                <Stat label="New employees" value={s.newInHr} />
                <Stat label="Changed" value={s.changed} />
                <Stat label="Resigned" value={s.resigned} />
              </div>
              <p className="mb-5 text-xs text-foreground/50">
                {s.datesFetched.length === 0
                  ? "Already up to date — no new days to fetch."
                  : s.datesFetched.length === 1
                    ? `Fetched ${s.datesFetched[0]}.`
                    : `Fetched ${s.datesFetched.length} days, ${s.datesFetched[0]} to ${s.datesFetched[s.datesFetched.length - 1]}.`}
                {s.rejected > 0 && ` ${s.rejected} record(s) rejected by validation.`}
              </p>

              {latest.status === "SUCCEEDED" && (
                <>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground/60">Synapse logins</h3>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <Stat label="New logins added" value={s.logins.created} tone={s.logins.created ? "good" : undefined} />
                    <Stat label="Deactivated (resigned)" value={s.logins.deactivated} />
                    <Stat label="Last working date set" value={s.logins.lastWorkingDateSet} />
                    <Stat label="Suspended (HR freeze)" value={s.logins.suspended} />
                    <Stat label="Restored (unfrozen)" value={s.logins.unsuspended} />
                    <Stat label="Need admin review" value={s.logins.reviewsRaised} tone={s.logins.reviewsRaised ? "warn" : undefined} />
                    <Stat label="Not added" value={notAddedTotal} tone={notAddedTotal ? "warn" : undefined} />
                  </div>
                  {notAdded.length > 0 && (
                    <div className="mt-3 rounded-md border border-border bg-surface px-4 py-3 text-sm">
                      <p className="mb-1 font-medium text-foreground">Active employees without a login, not added:</p>
                      <ul className="list-disc pl-5 text-foreground/70">
                        {notAdded.map(([reason, n]) => (
                          <li key={reason}>
                            {n} × {reason}
                            {reason.startsWith("No branch/department") && (
                              <>
                                {" "}— <Link href="/admin/hr-mapping" className="underline">map them in HR Mapping</Link>
                              </>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </section>
      )}

      {latest?.status === "SUCCEEDED" && created.length > 0 && (
        <section className="rounded-lg border border-border bg-card p-5">
          <h2 className="mb-1 text-base font-semibold text-foreground">New logins to hand over</h2>
          <p className="mb-3 text-sm text-foreground/60">
            No email was sent. The first password is the username with “-” replaced by “@”; each person must
            change it at first sign-in. No roles are assigned yet — assign them in User Master.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-foreground/60">
                <tr>
                  <th className="py-2 pr-4">Username</th>
                  <th className="py-2 pr-4">First password</th>
                  <th className="py-2 pr-4">Name</th>
                  <th className="py-2 pr-4">Emp. code</th>
                  <th className="py-2 pr-4">Department</th>
                </tr>
              </thead>
              <tbody>
                {created.map((u) => (
                  <tr key={u.uid} className="border-t border-border">
                    <td className="py-2 pr-4 font-mono">{u.username}</td>
                    <td className="py-2 pr-4 font-mono">{u.username.replace("-", "@")}</td>
                    <td className="py-2 pr-4">{u.fullName}</td>
                    <td className="py-2 pr-4">{u.employeeCode ?? "—"}</td>
                    <td className="py-2 pr-4">{u.department ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {jobs.length > 0 && (
        <section>
          <h2 className="mb-2 text-base font-semibold text-foreground">Recent syncs</h2>
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-foreground/60">
                <tr>
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2 text-center">Started</th>
                  <th className="px-3 py-2">By</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Fetched</th>
                  <th className="px-3 py-2 text-right">New</th>
                  <th className="px-3 py-2 text-right">Changed</th>
                  <th className="px-3 py-2 text-right">Resigned</th>
                  <th className="px-3 py-2 text-right">Logins added</th>
                  <th className="px-3 py-2 text-right">Deactivated</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id} className="border-t border-border">
                    <td className="px-3 py-2">{j.id}</td>
                    <td className="px-3 py-2 text-center">{formatDateTime(j.startedAt)}</td>
                    <td className="px-3 py-2">{j.startedBy}</td>
                    <td className={`px-3 py-2 ${j.status === "FAILED" ? "text-danger" : ""}`}>
                      {j.status === "RUNNING" ? "In progress" : j.status === "SUCCEEDED" ? "Completed" : "Failed"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{j.summary?.fetched ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{j.summary?.newInHr ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{j.summary?.changed ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{j.summary?.resigned ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{j.summary?.logins.created ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{j.summary?.logins.deactivated ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
