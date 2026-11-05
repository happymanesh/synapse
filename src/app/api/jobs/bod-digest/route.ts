import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { sendBodDigest } from "@/lib/bod-digest";

/**
 * Trigger for the start-of-day digest.
 *
 * The first route in Synapse with no session behind it — a scheduler has no user. It is
 * therefore authenticated by a shared secret rather than a cookie, and the whole route is
 * built to fail closed.
 *
 * Deliberately a plain HTTP endpoint rather than a built-in timer, because the production
 * deployment is in-house and the trigger has not been chosen yet: Windows Task Scheduler,
 * cron, a Railway cron service and a person with curl can all call this, and switching
 * between them changes nothing here. `npm run job:bod-digest` does the same work without
 * HTTP, for a host that would rather not expose the route at all.
 */

function authorized(request: NextRequest): boolean {
  const expected = process.env.JOB_TRIGGER_SECRET;

  // No secret configured means the job cannot be triggered over HTTP at all. Running it
  // unauthenticated would leave a route that mails the entire support desk open to anyone
  // who can reach the host.
  if (!expected) return false;

  const provided = request.headers.get("x-job-key") ?? "";
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // Compared in constant time, and only after the lengths match — timingSafeEqual throws on
  // a length mismatch, and the length is not worth leaking through an exception either.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    // Deliberately uninformative: a caller without the key learns nothing about whether one
    // is configured.
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }

  // ?dryRun=1 renders and reports without sending or recording, so the job can be proved
  // against real data before it is allowed to mail anybody.
  const dryRun = request.nextUrl.searchParams.get("dryRun") === "1";

  try {
    const result = await sendBodDigest({ dryRun });
    return NextResponse.json({ ok: true, dryRun, ...result });
  } catch (err) {
    console.error("[bod-digest] run failed:", err);
    // A 500 so a scheduler's own alerting sees the failure, rather than a 200 that hides it.
    return NextResponse.json({ ok: false, error: "Digest run failed. See server logs." }, { status: 500 });
  }
}
