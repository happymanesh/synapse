/**
 * Process A — HR ingestion from Spine into hr_employee.
 *
 *   npm run hr:ingest -- --from 2026-07-10    # initial load (Spine go-live), then every day since
 *   npm run hr:ingest                         # nightly: every day since the last success, to yesterday
 *   npm run hr:ingest -- --from 2026-09-01 --to 2026-09-05   # re-read specific dates
 *   npm run hr:ingest -- --from 2026-07-10 --backfill         # after adding fields: refill them,
 *                                                             # logged as BACKFILLED, not as changes
 *
 * Spine's ReqDate means "changed on that day", so every day must be fetched once; the
 * default catches up any missed nights and stops at the first failure.
 *
 * Writes only hr_* ingestion tables; never touches Synapse users (that is hr:lifecycle).
 * Output is counts only — no names, contacts or payloads.
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { todayInIndia } from "../src/lib/hr/dates";
import { ingestSpineRange, purgeRawRows } from "../src/lib/hr/ingest/ingest";
import { SpineClient, spineCredentialsFromEnv } from "../src/lib/hr/ingest/spine-client";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  if (v !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`${name} must be YYYY-MM-DD, got ${v}`);
  return v;
}

async function main() {
  const today = todayInIndia();
  const from = arg("--from");
  const to = arg("--to");
  const backfill = process.argv.includes("--backfill");
  console.log(`HR ingest (Spine): today ${today} (IST)${from ? `, from ${from}` : ""}${to ? `, to ${to}` : ""}${backfill ? ", BACKFILL" : ""}`);

  const purged = await purgeRawRows();
  if (purged) console.log(`  purged ${purged} raw rows past retention`);

  const results = await ingestSpineRange(new SpineClient(spineCredentialsFromEnv()), { today, from, to, backfill });
  if (!results.length) console.log("  nothing due");
  for (const r of results) {
    const s = r.summary;
    console.log(
      `  ${r.reqDate} run ${r.runId}: ${r.status}` +
        (s
          ? ` — received ${s.received}, inserted ${s.inserted}, updated ${s.updated}, unchanged ${s.unchanged},` +
            ` rejected ${s.rejected}, warned ${s.warned}, superseded ${s.superseded}` +
            (s.modifiedButUnknown ? `, modified-but-unknown ${s.modifiedButUnknown}` : "")
          : ` — ${r.error}`),
    );
  }
  if (results.some((r) => r.status === "FAILED")) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? `${e.name}: ${e.message}` : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
