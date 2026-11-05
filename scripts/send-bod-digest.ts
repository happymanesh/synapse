/**
 * The start-of-day digest, run from the command line.
 *
 * For a host that would rather schedule a command than expose an HTTP route — Windows Task
 * Scheduler and cron both do this more naturally than they do curl-with-a-secret. Does
 * exactly the same work as POST /api/jobs/bod-digest.
 *
 *   npm run job:bod-digest            send
 *   npm run job:bod-digest -- --dry   render and report, send nothing
 *
 * Exits non-zero when any digest failed to send, so a scheduler's own failure handling
 * sees it rather than the job always reporting success.
 */

import { sendBodDigest } from "../src/lib/bod-digest";

async function main() {
  const dryRun = process.argv.includes("--dry");
  const result = await sendBodDigest({ dryRun });

  console.log(dryRun ? "\nDRY RUN — nothing was sent or recorded\n" : "");
  for (const d of result.details) {
    console.log(`  ${d.outcome.padEnd(9)} ${d.username}${d.reason ? ` — ${d.reason}` : ""}`);
  }
  console.log(
    `\n${result.candidates} with open tickets · ${result.sent} sent · ${result.failed} failed · ` +
      `${result.skipped} already had today's · ${result.noEmail} without an address\n`
  );

  process.exit(result.failed > 0 ? 1 : 0);
}

void main();
