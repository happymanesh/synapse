import { formatDate } from "@/lib/report-format";

/**
 * Flattens an audit row for the table. The `changes` JSON is rendered to a single readable
 * line here, on the server, because a column render function cannot cross from a
 * server-rendered admin page to the client table (see AdminCrudTable's showWhen note).
 */
export function toAuditRow(r: {
  id: number;
  occurredAt: Date;
  actorUid: number | null;
  actorUsername: string;
  action: string;
  model: string;
  recordId: string | null;
  changes: unknown;
  ipAddress: string | null;
}) {
  return {
    id: r.id,
    when: `${formatDate(r.occurredAt)} ${r.occurredAt.toTimeString().slice(0, 8)}`,
    actorUsername: r.actorUsername,
    action: r.action,
    model: r.model,
    recordId: r.recordId ?? "—",
    summary: summarise(r.action, r.changes),
    ipAddress: r.ipAddress ?? "—",
  };
}

const MAX_SUMMARY = 160;

function summarise(action: string, changes: unknown): string {
  if (!changes || typeof changes !== "object") return "—";
  const entries = Object.entries(changes as Record<string, unknown>);
  if (entries.length === 0) return "—";

  const text =
    action === "UPDATE"
      ? entries
          .map(([field, c]) => {
            const d = c as { from?: unknown; to?: unknown };
            return d && typeof d === "object" && "to" in d ? `${field}: ${fmt(d.from)} → ${fmt(d.to)}` : field;
          })
          .join(", ")
      : entries.map(([field, v]) => `${field}=${fmt(v)}`).join(", ");

  return text.length > MAX_SUMMARY ? `${text.slice(0, MAX_SUMMARY)}…` : text;
}

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === "") return "∅";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return s.length > 40 ? `${s.slice(0, 40)}…` : s;
}
