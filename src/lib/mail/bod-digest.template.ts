/**
 * The start-of-day "tickets open with you" email.
 *
 * A pure function, like the ticket-forwarded template beside it: give it the facts, get back
 * a subject and two bodies. Same table-based layout and same IST stamp, so the two messages
 * read as coming from one system.
 */

import { istTimestamp } from "./ticket-forwarded.template";

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** `04-Nov`, for the compact per-row date. The year is in the subject line already. */
function shortDate(d: Date): string {
  return `${String(d.getDate()).padStart(2, "0")}-${SHORT_MONTHS[d.getMonth()]}`;
}

/** `3d 4h`, `5h`, `12m` — same shape the Triage Queue uses on screen. */
export function formatWait(hours: number): string {
  if (hours < 1) return "under an hour";
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest ? `${days}d ${rest}h` : `${days}d`;
}

export interface DigestRow {
  ticketNo: string;
  subject: string;
  ticketType: string;
  application: string;
  raisedAt: Date;
  waitingHours: number;
  overdue: boolean;
  url: string;
}

export interface BodDigestEmailInput {
  recipientName: string;
  rows: DigestRow[];
  overdueCount: number;
  unansweredCount: number;
  queueUrl: string;
  when: Date;
  responseTargetHours: number;
  productName: string;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

export function bodDigestEmail(input: BodDigestEmailInput): RenderedEmail {
  const count = input.rows.length;
  const stamp = istTimestamp(input.when);

  // The count leads, and overdue is called out in the subject. Someone scanning a phone at
  // 09:00 should learn whether today needs attention without opening anything.
  const subject =
    input.overdueCount > 0
      ? `${count} open ticket${count === 1 ? "" : "s"} with you — ${input.overdueCount} past target`
      : `${count} open ticket${count === 1 ? "" : "s"} with you`;

  const lines = input.rows
    .map(
      (r) =>
        `  ${r.ticketNo}  ${shortDate(r.raisedAt)}  ${formatWait(r.waitingHours).padEnd(7)}` +
        `${r.overdue ? "LATE  " : "      "}${r.subject}`
    )
    .join("\n");

  const summary =
    input.overdueCount > 0
      ? `${input.overdueCount} of these ${input.overdueCount === 1 ? "is" : "are"} past the ${input.responseTargetHours}-hour response target.`
      : `None are past the ${input.responseTargetHours}-hour response target.`;

  const text = `Good morning ${input.recipientName},

You have ${count} open ticket${count === 1 ? "" : "s"} assigned to you, longest-waiting first.

${summary}
${input.unansweredCount > 0 ? `${input.unansweredCount} ${input.unansweredCount === 1 ? "has" : "have"} had no reply yet.\n` : ""}
${lines}

Open the triage queue:
  ${input.queueUrl}

Sent ${stamp} IST by ${input.productName}. Please do not reply.

Shah Investors Home Ltd`;

  const name = escapeHtml(input.recipientName);
  const product = escapeHtml(input.productName);

  const rowsHtml = input.rows
    .map(
      (r) => `
          <tr>
            <td style="padding:7px 8px;border-bottom:1px solid #eef1f4;font-family:Consolas,Menlo,Monaco,'Courier New',monospace;font-size:12px;white-space:nowrap;">
              <a href="${escapeHtml(r.url)}" style="color:#0f2e5c;text-decoration:none;font-weight:700;">${escapeHtml(r.ticketNo)}</a>
            </td>
            <td style="padding:7px 8px;border-bottom:1px solid #eef1f4;font-size:13px;color:#1f2933;">
              ${escapeHtml(r.subject)}
              <div style="font-size:11px;color:#7b8794;">${escapeHtml(r.ticketType)} · ${escapeHtml(r.application)}</div>
            </td>
            <td style="padding:7px 8px;border-bottom:1px solid #eef1f4;font-size:12px;color:#52606d;white-space:nowrap;">${escapeHtml(shortDate(r.raisedAt))}</td>
            <td style="padding:7px 8px;border-bottom:1px solid #eef1f4;font-size:12px;white-space:nowrap;text-align:right;color:${r.overdue ? "#a32b2b" : "#52606d"};${r.overdue ? "font-weight:700;" : ""}">
              ${escapeHtml(formatWait(r.waitingHours))}${r.overdue ? " late" : ""}
            </td>
          </tr>`
    )
    .join("");

  const html = `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#f4f5f7;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border-radius:8px;border:1px solid #e3e6ea;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2933;">
        <tr><td style="padding:22px 28px 0;">
          <p style="margin:0;font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#0f2e5c;">${product}</p>
        </td></tr>
        <tr><td style="padding:14px 28px 0;">
          <h1 style="margin:0;font-size:20px;line-height:1.3;font-weight:700;">${count} open ticket${count === 1 ? "" : "s"} with you</h1>
          <p style="margin:6px 0 0;font-size:14px;color:#52606d;">Good morning ${name} — longest-waiting first.</p>
        </td></tr>

        <tr><td style="padding:16px 28px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${input.overdueCount > 0 ? "#fff4f4" : "#f7f9fc"};border:1px solid ${input.overdueCount > 0 ? "#f0c2c2" : "#cfd8e3"};border-radius:6px;">
            <tr><td style="padding:10px 14px;font-size:13px;color:${input.overdueCount > 0 ? "#a32b2b" : "#52606d"};">
              ${input.overdueCount > 0 ? `<strong>${input.overdueCount} past the ${input.responseTargetHours}-hour response target.</strong>` : `None past the ${input.responseTargetHours}-hour response target.`}
              ${input.unansweredCount > 0 ? ` ${input.unansweredCount} with no reply yet.` : ""}
            </td></tr>
          </table>
        </td></tr>

        <tr><td style="padding:14px 20px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rowsHtml}
          </table>
        </td></tr>

        <tr><td style="padding:18px 28px 0;" align="center">
          <a href="${escapeHtml(input.queueUrl)}" style="display:inline-block;background:#0f2e5c;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:11px 26px;border-radius:6px;">Open the triage queue</a>
        </td></tr>

        <tr><td style="padding:22px 28px 26px;border-top:1px solid #eef1f4;">
          <p style="margin:14px 0 0;font-size:12px;line-height:1.5;color:#7b8794;">
            Sent ${escapeHtml(stamp)} IST by ${product}. Please do not reply to this email.<br>
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
