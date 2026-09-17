/**
 * The "a ticket has been forwarded to you" email.
 *
 * A pure function: give it the facts, get back a subject and two bodies. No config
 * lookup, no clock, no I/O — which keeps the wording testable and means the template
 * has no reason to reach for a database.
 *
 * Deliberately modelled on SIHL ONE's password-reset template (same table-based
 * layout, same escaping, same IST stamp), so system mail from the two systems reads
 * as coming from one organisation rather than two.
 */

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * `17-Sep-2026 16:24`, in IST.
 *
 * Four-digit year, matching SIHL ONE's system mail: this is prose a person reads
 * once, not a fixed-width column, so it does not follow the app's own dd-Mmm-yy
 * convention. The timezone is pinned rather than inherited, so the stamp is right
 * even if the sending container is misconfigured.
 */
export function istTimestamp(when: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(when);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  const month = SHORT_MONTHS[Number(part("month")) - 1] ?? part("month");
  return `${part("day")}-${month}-${part("year")} ${part("hour")}:${part("minute")}`;
}

/** Anything interpolated into the HTML is escaped — subjects, names and remarks are user input. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Whole hours waiting, for the "waiting N hours" line. */
function hoursSince(from: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - from.getTime()) / 3_600_000));
}

export interface TicketForwardedEmailInput {
  recipientName: string;
  ticketNo: string;
  subject: string;
  /** Resolved type, e.g. "Bug" or "Others — Data correction". */
  ticketType: string;
  application: string;
  segment: string;
  /** Who raised it — a real name, or the captured guest name. */
  raisedBy: string;
  raisedAt: Date;
  /** The turnaround clock. Differs from raisedAt only after a merge. */
  clockStartedAt: Date;
  /** Who forwarded it, and why. §4.5 makes the reason mandatory. */
  forwardedBy: string;
  reason: string;
  /** Deep link to the ticket. */
  ticketUrl: string;
  when: Date;
  responseTargetHours: number;
  productName: string;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

export function ticketForwardedEmail(input: TicketForwardedEmailInput): RenderedEmail {
  const stamp = istTimestamp(input.when);
  const raised = istTimestamp(input.raisedAt);
  const waiting = hoursSince(input.clockStartedAt, input.when);
  const overdue = waiting >= input.responseTargetHours;

  // The ticket number leads, so a reply or a search finds the thread. The subject
  // line carries the raiser's own words rather than a generic phrase — a desk
  // triaging twenty of these should be able to act from the inbox list alone.
  const subject = `[${input.ticketNo}] Forwarded to you — ${input.subject}`;

  const waitingLine = overdue
    ? `Waiting: ${waiting} hours — past the ${input.responseTargetHours}-hour response target`
    : `Waiting: ${waiting} hours (response target is ${input.responseTargetHours} hours)`;

  const text = `Hello ${input.recipientName},

${input.forwardedBy} has forwarded a support ticket to you.

Ticket: ${input.ticketNo}
Subject: ${input.subject}
Type: ${input.ticketType}
Application: ${input.application}
Segment: ${input.segment}
Raised by: ${input.raisedBy}
Raised: ${raised} IST
${waitingLine}

Why it was forwarded to you
${input.reason}

The ticket is now assigned to you. Open it to add a remark, forward it on, revise the
timeline, or mark it resolved.

  ${input.ticketUrl}

Forwarded ${stamp} IST by ${input.forwardedBy}.

This is an automated message from ${input.productName}. Please do not reply.

Shah Investors Home Ltd`;

  const name = escapeHtml(input.recipientName);
  const product = escapeHtml(input.productName);
  const url = escapeHtml(input.ticketUrl);

  const row = (label: string, value: string) => `
          <tr>
            <td style="padding:0 0 8px;font-size:13px;color:#52606d;width:34%;vertical-align:top;">${escapeHtml(label)}</td>
            <td style="padding:0 0 8px;font-size:14px;color:#1f2933;font-weight:600;">${escapeHtml(value)}</td>
          </tr>`;

  // Table-based layout with inline styles: Outlook ignores <style> blocks and most of
  // flexbox, and this has to survive a desktop client as well as a phone.
  const html = `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#f4f5f7;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px;border:1px solid #e3e6ea;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2933;">
        <tr><td style="padding:22px 28px 0;">
          <p style="margin:0;font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#0f2e5c;">${product}</p>
        </td></tr>
        <tr><td style="padding:14px 28px 0;">
          <h1 style="margin:0;font-size:20px;line-height:1.3;font-weight:700;">A ticket has been forwarded to you</h1>
        </td></tr>
        <tr><td style="padding:14px 28px 0;font-size:15px;line-height:1.6;">
          <p style="margin:0 0 14px;">Hello ${name},</p>
          <p style="margin:0 0 4px;">${escapeHtml(input.forwardedBy)} has forwarded a support ticket to you. It is now assigned to you.</p>
        </td></tr>

        <tr><td style="padding:16px 28px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f9fc;border:1px solid #cfd8e3;border-radius:6px;">
            <tr><td align="center" style="padding:12px 16px;font-family:Consolas,Menlo,Monaco,'Courier New',monospace;font-size:17px;font-weight:700;letter-spacing:.05em;color:#0f2e5c;">${escapeHtml(input.ticketNo)}</td></tr>
          </table>
          <p style="margin:12px 0 0;font-size:16px;font-weight:600;line-height:1.4;">${escapeHtml(input.subject)}</p>
        </td></tr>

        <tr><td style="padding:16px 28px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${row("Type", input.ticketType)}${row("Application", input.application)}${row("Segment", input.segment)}${row("Raised by", input.raisedBy)}${row("Raised", `${raised} IST`)}
          </table>
        </td></tr>

        <tr><td style="padding:4px 28px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${overdue ? "#fff4f4" : "#f7f9fc"};border:1px solid ${overdue ? "#f0c2c2" : "#cfd8e3"};border-radius:6px;">
            <tr><td style="padding:10px 14px;font-size:14px;color:${overdue ? "#a32b2b" : "#52606d"};">
              ${overdue ? "<strong>Past the response target.</strong> " : ""}Waiting ${waiting} hour${waiting === 1 ? "" : "s"}${overdue ? "" : ` — target is ${input.responseTargetHours} hours`}.
            </td></tr>
          </table>
        </td></tr>

        <tr><td style="padding:18px 28px 0;font-size:14px;line-height:1.6;">
          <strong>Why it was forwarded to you</strong>
          <p style="margin:6px 0 0;color:#52606d;white-space:pre-wrap;">${escapeHtml(input.reason)}</p>
        </td></tr>

        <tr><td style="padding:18px 28px 0;" align="center">
          <a href="${url}" style="display:inline-block;background:#0f2e5c;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:11px 26px;border-radius:6px;">Open ticket ${escapeHtml(input.ticketNo)}</a>
        </td></tr>

        <tr><td style="padding:18px 28px 0;font-size:14px;line-height:1.6;color:#52606d;">
          <p style="margin:0;">Open it to add a remark, forward it on, revise the timeline, or mark it resolved.</p>
        </td></tr>

        <tr><td style="padding:22px 28px 26px;border-top:1px solid #eef1f4;">
          <p style="margin:14px 0 0;font-size:12px;line-height:1.5;color:#7b8794;">
            Forwarded ${escapeHtml(stamp)} IST by ${escapeHtml(input.forwardedBy)}.<br>
            This is an automated message from ${product}. Please do not reply to this email.<br>
            Shah Investors Home Ltd
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject, text, html };
}
