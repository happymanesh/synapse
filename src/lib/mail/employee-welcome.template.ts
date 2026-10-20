/**
 * The "your Synapse account is ready" email, sent when the HR lifecycle provisions an
 * employee. A pure function, like ticket-forwarded.template.ts, whose layout it follows so
 * system mail reads as coming from one organisation.
 *
 * It carries the first password. That password is derivable from the username anyway (SIHL's
 * rule: SIHL-0123 -> SIHL@0123), so the email adds no secret that was not already guessable;
 * the protection is that it must be changed at first sign-in. The caller never sends this to a
 * mailbox shared by several employees — see the lifecycle's shared-mailbox check.
 */
import { istTimestamp } from "./ticket-forwarded.template";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface EmployeeWelcomeEmailInput {
  recipientName: string;
  username: string;
  initialPassword: string;
  loginUrl: string;
  productName: string;
  when: Date;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

export function employeeWelcomeEmail(input: EmployeeWelcomeEmailInput): RenderedEmail {
  const stamp = istTimestamp(input.when);
  const subject = `Your ${input.productName} account is ready — ${input.username}`;

  const text = `Hello ${input.recipientName},

An account has been created for you on ${input.productName}.

Username: ${input.username}
Password: ${input.initialPassword}

Sign in here:
  ${input.loginUrl}

You will be asked to choose a new password the first time you sign in. Please do this
straight away, and do not share these details with anyone.

If you did not expect this email, contact your administrator.

Created ${stamp} IST.
This is an automated message from ${input.productName}. Please do not reply.

Shah Investors Home Ltd`;

  const product = escapeHtml(input.productName);
  const url = escapeHtml(input.loginUrl);
  const mono = "font-family:Consolas,Menlo,Monaco,'Courier New',monospace;font-size:16px;font-weight:700;color:#0f2e5c;";

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
          <h1 style="margin:0;font-size:20px;line-height:1.3;font-weight:700;">Your account is ready</h1>
        </td></tr>
        <tr><td style="padding:14px 28px 0;font-size:15px;line-height:1.6;">
          <p style="margin:0 0 14px;">Hello ${escapeHtml(input.recipientName)},</p>
          <p style="margin:0;">An account has been created for you on ${product}.</p>
        </td></tr>
        <tr><td style="padding:16px 28px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f9fc;border:1px solid #cfd8e3;border-radius:6px;">
            <tr><td style="padding:12px 16px 4px;font-size:13px;color:#52606d;">Username</td></tr>
            <tr><td style="padding:0 16px 10px;${mono}">${escapeHtml(input.username)}</td></tr>
            <tr><td style="padding:4px 16px 4px;font-size:13px;color:#52606d;">Password</td></tr>
            <tr><td style="padding:0 16px 12px;${mono}">${escapeHtml(input.initialPassword)}</td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:18px 28px 0;" align="center">
          <a href="${url}" style="display:inline-block;background:#0f2e5c;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:11px 26px;border-radius:6px;">Sign in</a>
        </td></tr>
        <tr><td style="padding:18px 28px 0;font-size:14px;line-height:1.6;">
          <p style="margin:0;"><strong>You will be asked to choose a new password the first time you sign in.</strong>
          Please do this straight away, and do not share these details with anyone.</p>
          <p style="margin:10px 0 0;color:#52606d;">If you did not expect this email, contact your administrator.</p>
        </td></tr>
        <tr><td style="padding:22px 28px 26px;border-top:1px solid #eef1f4;">
          <p style="margin:14px 0 0;font-size:12px;line-height:1.5;color:#7b8794;">
            Created ${escapeHtml(stamp)} IST.<br>
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
