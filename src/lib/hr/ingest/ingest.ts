/**
 * Process A — HR ingestion from Spine. Land -> curate -> update canonical -> reconcile.
 *
 *   1. Land:      fetch Created + Modified for one date; write the 11 fields, as sent, to
 *                 hr_raw_employee under one hr_ingest_run. If either fetch fails the run is
 *                 FAILED and stops here — hr_employee is not touched for that date.
 *   2. Curate:    curateSpineRecord() each landed row; mark it ACCEPTED / WARNED / REJECTED /
 *                 SUPERSEDED with notes.
 *   3. Canonical: insert or update hr_employee, one row per Spine code; every field change
 *                 goes to hr_employee_change.
 *   4. Reconcile: counts on the run (received = superseded + rejected + inserted + updated +
 *                 unchanged), plus signals worth a look, e.g. a Modified record for an
 *                 employee never seen before (a missed date, or no initial load).
 *
 * Spine's ReqDate means "changed ON that day" (probed 2026-10-07), so a day that is never
 * fetched is lost. ingestSpineRange() therefore catches up every day since the last
 * successful run, stopping at the first failure so the next run resumes there.
 *
 * Touches only hr_* ingestion tables. Knows nothing about Synapse users — that is process B
 * (src/lib/hr/lifecycle), which reads hr_employee and nothing else from here.
 */
import { prisma } from "../../db";
import { fromDbDate, toDbDate, type IsoDate } from "../dates";
import { DETAIL_FIELDS, type CanonicalEmployee, type EmployeeDetails, type EmploymentStatus } from "../employee";
import { SpineClient, type SpineReqType } from "./spine-client";
import { SpineApiError } from "./spine-core";
import { SPINE_SOURCE, curateSpineRecord, diffEmployee, planIngestDates, supersededPositions } from "./curate-core";

/** Raw rows are evidence for reconciliation, not a store. */
export const RAW_RETENTION_DAYS = Number(process.env.HR_RAW_RETENTION_DAYS ?? 30);

const REQ_TYPES: SpineReqType[] = ["Created", "Modified"];

export interface IngestSummary {
  received: number;
  superseded: number;
  rejected: number;
  warned: number;
  inserted: number;
  updated: number;
  unchanged: number;
  /** Modified for an employee hr_employee has never seen: a missed date, or no initial load. */
  modifiedButUnknown: number;
  fieldChanges: number;
}

export interface IngestResult {
  reqDate: IsoDate;
  runId: number;
  status: "SUCCEEDED" | "FAILED";
  summary: IngestSummary | null;
  error?: string;
}

type EmployeeRow = Awaited<ReturnType<typeof prisma.hrEmployee.findMany>>[number];

function rowToCanonical(r: EmployeeRow): CanonicalEmployee {
  return {
    sourceSystem: r.sourceSystem,
    sourceEmployeeId: r.sourceEmployeeId,
    previousSourceEmployeeId: r.previousSourceEmployeeId,
    sourceCompanyCode: r.sourceCompanyCode,
    firstName: r.firstName,
    lastName: r.lastName,
    email: r.email,
    mobile: r.mobile,
    branch: r.branch,
    department: r.department,
    sourceStatus: r.sourceStatus,
    employmentStatus: r.employmentStatus as EmploymentStatus,
    lastWorkingDate: fromDbDate(r.lastWorkingDate),
    lastWorkingDateInvalid: r.lastWorkingDateInvalid,
    onLeave: r.onLeave,
    details: Object.fromEntries(
      DETAIL_FIELDS.map((f) => [f, DATE_DETAILS.has(f) ? fromDbDate(r[f] as Date | null) : r[f]]),
    ) as unknown as EmployeeDetails,
  };
}

/** Detail fields held as DATE columns (the rest are text or boolean, stored as-is). */
const DATE_DETAIL_FIELDS = [
  "joinDate", "groupJoinDate", "confirmationDate", "probationDate", "retirementDate", "resignationDate", "frozenDate",
] as const satisfies readonly (keyof EmployeeDetails)[];
type DateDetail = (typeof DATE_DETAIL_FIELDS)[number];
const DATE_DETAILS = new Set<keyof EmployeeDetails>(DATE_DETAIL_FIELDS);

/** EmployeeDetails as hr_employee columns: calendar dates become Date, everything else as-is. */
type DetailColumns = { [K in keyof EmployeeDetails]: K extends DateDetail ? Date | null : EmployeeDetails[K] };

function detailData(d: EmployeeDetails): DetailColumns {
  return Object.fromEntries(
    DETAIL_FIELDS.map((f) => [f, DATE_DETAILS.has(f) && d[f] ? toDbDate(d[f] as IsoDate) : d[f]]),
  ) as DetailColumns;
}

/** The writable hr_employee columns for a curated employee. */
function canonicalData(e: CanonicalEmployee) {
  return {
    previousSourceEmployeeId: e.previousSourceEmployeeId,
    sourceCompanyCode: e.sourceCompanyCode,
    firstName: e.firstName,
    lastName: e.lastName,
    email: e.email,
    mobile: e.mobile,
    branch: e.branch,
    department: e.department,
    sourceStatus: e.sourceStatus,
    employmentStatus: e.employmentStatus,
    lastWorkingDate: e.lastWorkingDate ? toDbDate(e.lastWorkingDate) : null,
    lastWorkingDateInvalid: e.lastWorkingDateInvalid,
    onLeave: e.onLeave,
    ...detailData(e.details),
  };
}

function errorText(e: unknown): string {
  if (e instanceof SpineApiError) return e.message;
  const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  return msg.slice(0, 300);
}

/** Purge raw rows past retention. Called once per invocation, not per date. */
export async function purgeRawRows(): Promise<number> {
  const cutoff = new Date(Date.now() - RAW_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const { count } = await prisma.hrRawEmployee.deleteMany({ where: { receivedAt: { lt: cutoff } } });
  return count;
}

/** The latest Spine date that ingested successfully, or null if none ever has. */
export async function lastSucceededDate(): Promise<IsoDate | null> {
  const r = await prisma.hrIngestRun.findFirst({
    where: { sourceSystem: SPINE_SOURCE, status: "SUCCEEDED" },
    orderBy: { reqDate: "desc" },
    select: { reqDate: true },
  });
  return r ? fromDbDate(r.reqDate) : null;
}

/** Ingest one Spine date. */
/**
 * `backfill`: re-ingesting dates already loaded, after new fields were added. Changes are
 * logged as BACKFILLED rather than FIELD_CHANGED, so the history does not read as everyone
 * changing on the day the columns were added. Last-seen/changed timestamps are not moved.
 */
export async function ingestSpine(
  client: SpineClient,
  reqDate: IsoDate,
  today: IsoDate,
  opts: { backfill?: boolean } = {},
): Promise<IngestResult> {
  const changeType = opts.backfill ? "BACKFILLED" : "FIELD_CHANGED";
  const run = await prisma.hrIngestRun.create({
    data: { sourceSystem: SPINE_SOURCE, reqTypes: REQ_TYPES.join(","), reqDate: toDbDate(reqDate) },
  });

  try {
    // ---- 1. Land -----------------------------------------------------------------
    let recordNo = 0;
    for (const reqType of REQ_TYPES) {
      const records = await client.getEmployees(reqType, reqDate);
      if (records.length) {
        await prisma.hrRawEmployee.createMany({
          data: records.map((r) => ({ runId: run.id, reqType, recordNo: recordNo++, ...r })),
        });
      }
    }

    // ---- 2-3. Curate and apply to hr_employee -------------------------------------
    const raw = await prisma.hrRawEmployee.findMany({ where: { runId: run.id }, orderBy: { recordNo: "asc" } });
    const superseded = supersededPositions(raw.map((r) => r.employeeCode));

    // Normalised the same way curation normalises codes, so the lookup cannot miss a row.
    const codes = raw.map((r) => r.employeeCode?.replace(/\s+/g, " ").trim()).filter((c): c is string => !!c);
    const existing = await prisma.hrEmployee.findMany({ where: { sourceSystem: SPINE_SOURCE, sourceEmployeeId: { in: codes } } });
    const byCode = new Map(existing.map((r) => [r.sourceEmployeeId, r]));

    const s: IngestSummary = {
      received: raw.length, superseded: 0, rejected: 0, warned: 0, inserted: 0,
      updated: 0, unchanged: 0, modifiedButUnknown: 0, fieldChanges: 0,
    };
    const now = new Date();

    for (const [i, row] of raw.entries()) {
      const rawUpdate = (curationStatus: string, notes: string[]) => ({
        where: { id: row.id },
        data: { curationStatus, curationNotes: notes.length ? notes.join("; ") : null },
      });

      if (superseded.has(i)) {
        s.superseded++;
        await prisma.hrRawEmployee.update(rawUpdate("SUPERSEDED", ["A later record in this run has the same Employee_Code"]));
        continue;
      }

      const cur = curateSpineRecord(row, today);
      if (!cur.employee) {
        s.rejected++;
        await prisma.hrRawEmployee.update(rawUpdate("REJECTED", cur.notes));
        continue;
      }
      const emp = cur.employee;
      if (cur.status === "WARNED") s.warned++;
      const prev = byCode.get(emp.sourceEmployeeId);

      if (!prev) {
        if (row.reqType === "Modified") s.modifiedButUnknown++;
        const created = await prisma.$transaction(async (tx) => {
          const c = await tx.hrEmployee.create({
            data: { sourceSystem: SPINE_SOURCE, sourceEmployeeId: emp.sourceEmployeeId, ...canonicalData(emp), lastRunId: run.id },
          });
          await tx.hrEmployeeChange.create({ data: { hrEmployeeId: c.id, runId: run.id, changeType: "FIRST_SEEN" } });
          await tx.hrRawEmployee.update(rawUpdate(cur.status, cur.notes));
          return c;
        });
        byCode.set(created.sourceEmployeeId, created);
        s.inserted++;
        continue;
      }

      const changes = diffEmployee(rowToCanonical(prev), emp);
      const updated = await prisma.$transaction(async (tx) => {
        if (changes.length) {
          await tx.hrEmployeeChange.createMany({
            data: changes.map((c) => ({ hrEmployeeId: prev.id, runId: run.id, changeType, ...c })),
          });
        }
        const u = await tx.hrEmployee.update({
          where: { id: prev.id },
          data: !changes.length
            ? { lastSeenAt: now, lastRunId: run.id }
            : opts.backfill
              ? { ...canonicalData(emp), lastRunId: run.id }
              : { ...canonicalData(emp), lastSeenAt: now, lastChangedAt: now, lastRunId: run.id },
        });
        await tx.hrRawEmployee.update(rawUpdate(cur.status, cur.notes));
        return u;
      });
      byCode.set(updated.sourceEmployeeId, updated);
      s.fieldChanges += changes.length;
      if (changes.length) s.updated++;
      else s.unchanged++;
    }

    // ---- 4. Reconcile ---------------------------------------------------------------
    const accounted = s.superseded + s.rejected + s.inserted + s.updated + s.unchanged;
    if (accounted !== s.received) {
      throw new Error(`Reconciliation failed: received ${s.received}, accounted for ${accounted}`);
    }

    await prisma.hrIngestRun.update({
      where: { id: run.id },
      data: { status: "SUCCEEDED", finishedAt: new Date(), summary: { ...s } },
    });
    return { reqDate, runId: run.id, status: "SUCCEEDED", summary: s };
  } catch (e) {
    const error = errorText(e);
    await prisma.hrIngestRun.update({ where: { id: run.id }, data: { status: "FAILED", finishedAt: new Date(), error } });
    return { reqDate, runId: run.id, status: "FAILED", summary: null, error };
  }
}

/**
 * Ingest every date that is due, oldest first, stopping at the first failure. Without
 * `from`, resumes the day after the last successful run; the first ever run must be given
 * `from` (the initial load — see planIngestDates).
 */
export async function ingestSpineRange(
  client: SpineClient,
  opts: { today: IsoDate; from?: IsoDate; to?: IsoDate; backfill?: boolean },
): Promise<IngestResult[]> {
  if (opts.backfill && !opts.from) throw new Error("--backfill needs --from: say which already-loaded dates to re-read");
  const dates = planIngestDates({ lastSucceeded: await lastSucceededDate(), today: opts.today, from: opts.from, to: opts.to });
  const results: IngestResult[] = [];
  for (const d of dates) {
    const r = await ingestSpine(client, d, opts.today, { backfill: opts.backfill });
    results.push(r);
    if (r.status === "FAILED") break;
  }
  return results;
}
