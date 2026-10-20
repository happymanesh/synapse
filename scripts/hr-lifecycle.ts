/**
 * Process B — apply HR facts (hr_employee) to Synapse users. Source-agnostic.
 *
 *   npm run hr:lifecycle                                   # dry run: report only, writes nothing
 *   npm run hr:lifecycle -- --apply                        # deactivate / suspend / unsuspend / review, sync profiles
 *   npm run hr:lifecycle -- --apply --provision            # ...and create accounts for new joiners
 *   npm run hr:lifecycle -- --apply --provision --send-email   # ...and email them their login
 *
 * Runs with the react-server condition (see package.json) because the mailer is server-only.
 * Output names employees by source code and Synapse username only.
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { todayInIndia } from "../src/lib/hr/dates";
import { runLifecycle } from "../src/lib/hr/lifecycle/lifecycle";
import { getMailer, mailConfig } from "../src/lib/mail/mailer";

async function main() {
  const apply = process.argv.includes("--apply");
  const provision = process.argv.includes("--provision");
  const sendEmail = process.argv.includes("--send-email");
  if (provision && !apply) throw new Error("--provision needs --apply");
  if (sendEmail && !provision) throw new Error("--send-email needs --provision");
  const today = todayInIndia();
  console.log(`HR lifecycle: ${apply ? "APPLY" : "dry run"}${provision ? " + PROVISION" : ""}${sendEmail ? " + EMAIL" : ""}, today ${today} (IST)`);

  const cfg = mailConfig();
  const r = await runLifecycle({
    today,
    apply,
    provision,
    mailer: sendEmail ? getMailer(cfg) : undefined,
    loginUrl: `${cfg.appUrl.replace(/\/$/, "")}/login`,
    productName: cfg.fromName,
  });

  const counts: Record<string, number> = {};
  for (const o of r.outcomes) {
    counts[o.decision.kind] = (counts[o.decision.kind] ?? 0) + 1;
    if (o.freeze.kind !== "NONE") counts[o.freeze.kind] = (counts[o.freeze.kind] ?? 0) + 1;
    if (o.profileUpdated.length) counts.PROFILE = (counts.PROFILE ?? 0) + 1;
  }
  console.log(`  linked employees: ${r.outcomes.length}`, counts);

  const p = r.provisioning;
  console.log(`  active employees without a Synapse user: ${r.unprovisionedJoiners}`);
  console.log(`    ${provision ? "created" : "ready to create"}: ${provision ? p.created.length : p.ready.length}, blocked: ${p.blocked.length}`);
  const blockedByReason: Record<string, number> = {};
  for (const b of p.blocked) {
    const key = b.reason.startsWith("No mapping for") ? "no branch/department -> hierarchy mapping" : b.reason;
    blockedByReason[key] = (blockedByReason[key] ?? 0) + 1;
  }
  for (const [reason, n] of Object.entries(blockedByReason)) console.log(`      ${n} × ${reason}`);
  if (sendEmail) {
    console.log(`    welcome emails sent: ${p.emailed.length}, not sent: ${p.emailSkipped.length}`);
    for (const s of p.emailSkipped) console.log(`      ${s.username} — ${s.reason}`);
  }
  console.log(`  on leave (recorded only): ${r.onLeave}`);

  for (const o of r.outcomes) {
    if (o.freeze.kind !== "NONE") {
      const tag = o.freezeApplied ? (o.freeze.kind === "SUSPEND" ? "SUSPENDED" : "UNSUSPENDED") : apply ? `${o.freeze.kind} (no change)` : `WOULD ${o.freeze.kind}`;
      console.log(`  ${tag.padEnd(22)} ${o.sourceEmployeeId} ${o.username} — ${o.freeze.reason}`);
    }
    if (o.profileUpdated.length) {
      console.log(`  ${(apply ? "PROFILE UPDATED" : "WOULD UPDATE PROFILE").padEnd(22)} ${o.sourceEmployeeId} ${o.username} — ${o.profileUpdated.join(", ")}`);
    }
    if (o.decision.kind === "NONE") continue;
    const tag =
      o.decision.kind === "DEACTIVATE"
        ? o.applied ? "DEACTIVATED" : apply ? "DEACTIVATE (no change)" : "WOULD DEACTIVATE"
        : o.decision.kind;
    console.log(`  ${tag.padEnd(22)} ${o.sourceEmployeeId} ${o.username} — ${o.decision.reason}`);
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? `${e.name}: ${e.message}` : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
