import "server-only";

/**
 * System email for Synapse.
 *
 * Deliberately modelled on SIHL ONE's mailer (apps/api/src/modules/mail/mailer.ts):
 * SendGrid's v3 REST API over plain `fetch`, with a no-op default. The SDK is a thin
 * wrapper over one request, and a dependency that buys a JSON body and a bearer header
 * is not worth the supply-chain surface in a system holding client data.
 *
 * Separate from the `channel_message` queue. That queue is the record of what the module
 * intends to send — acknowledgements, document deliveries — and binding it to a live
 * provider would turn on real sending for every purpose at once. This seam carries one
 * message: telling a member of staff that a ticket is now theirs. Two seams, two blast
 * radii.
 */

export interface OutboundEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface EmailResult {
  accepted: boolean;
  providerMessageId: string | null;
  failureReason: string | null;
}

export interface MailConfig {
  driver: "noop" | "sendgrid";
  apiKey: string | undefined;
  from: string | undefined;
  fromName: string;
  appUrl: string;
}

export function mailConfig(): MailConfig {
  const driver = process.env.MAIL_DRIVER === "sendgrid" ? "sendgrid" : "noop";
  return {
    driver,
    apiKey: process.env.SENDGRID_API_KEY,
    from: process.env.MAIL_FROM,
    fromName: process.env.MAIL_FROM_NAME ?? "SIHL Synapse",
    appUrl: process.env.MAIL_APP_URL ?? "http://localhost:3010",
  };
}

/** Masked for logs: enough to identify a recipient, not enough to be a mailing list. */
export function maskEmail(address: string): string {
  const [local = "", domain = ""] = address.split("@");
  return `${local.slice(0, 2)}***@${domain}`;
}

export interface Mailer {
  send(email: OutboundEmail): Promise<EmailResult>;
}

/**
 * The default. Logs that an email would have gone out and sends nothing.
 *
 * This is what runs in development, in CI, and anywhere MAIL_DRIVER is unset, so no test
 * run and no local experiment can mail a real member of staff.
 *
 * It reports FAILURE, not success. Claiming an email was accepted when none left the
 * building would show the desk "Emailed to Priya" while Priya waits for something that is
 * never coming — and if a deploy ever went out with MAIL_DRIVER unset, that lie would be
 * the only symptom. Saying so plainly makes the forwarding staff member follow up by hand,
 * which is the right behaviour when there is no mailer.
 */
export class NoopMailer implements Mailer {
  send(email: OutboundEmail): Promise<EmailResult> {
    console.info(`[mail] not sent (MAIL_DRIVER=noop) to ${maskEmail(email.to)}: ${email.subject}`);
    return Promise.resolve({
      accepted: false,
      providerMessageId: null,
      failureReason: "No mailer configured (MAIL_DRIVER=noop)",
    });
  }
}

/** SendGrid, over its v3 REST API. */
export class SendGridMailer implements Mailer {
  private readonly endpoint = "https://api.sendgrid.com/v3/mail/send";

  constructor(private readonly config: MailConfig) {}

  async send(email: OutboundEmail): Promise<EmailResult> {
    const { apiKey, from, fromName } = this.config;
    if (!apiKey || !from) {
      // A silent no-send is worse than a loud failure.
      return { accepted: false, providerMessageId: null, failureReason: "Mailer not configured" };
    }

    // A hung provider must not hold a request open indefinitely. The caller treats a
    // failure as non-fatal, so timing out is safe.
    const signal = AbortSignal.timeout(15_000);

    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: email.to }] }],
          from: { email: from, name: fromName },
          reply_to: { email: from },
          subject: email.subject,
          content: [
            // Order matters to the RFC: the richest part goes last, so a client that
            // understands HTML picks it over the plain-text fallback.
            { type: "text/plain", value: email.text },
            { type: "text/html", value: email.html },
          ],
        }),
        signal,
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        const reason = firstError(detail) ?? `HTTP ${response.status}`;
        console.error(`[mail] refused by SendGrid for ${maskEmail(email.to)}: ${reason}`);
        return { accepted: false, providerMessageId: null, failureReason: reason };
      }

      const id = response.headers.get("x-message-id");
      console.info(`[mail] accepted for ${maskEmail(email.to)} (${id ?? "no id"})`);
      return { accepted: true, providerMessageId: id, failureReason: null };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.error(`[mail] failed for ${maskEmail(email.to)}: ${reason}`);
      return { accepted: false, providerMessageId: null, failureReason: reason };
    }
  }
}

/** SendGrid replies with a JSON errors array; take the first message — this ends up in a log line. */
function firstError(body: string): string | null {
  try {
    const parsed: unknown = JSON.parse(body);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "errors" in parsed &&
      Array.isArray((parsed as { errors: unknown[] }).errors)
    ) {
      return (parsed as { errors: Array<{ message?: string }> }).errors[0]?.message ?? null;
    }
  } catch {
    // Not JSON. The status code is a better answer than a wall of HTML.
  }
  return null;
}

export function getMailer(config: MailConfig = mailConfig()): Mailer {
  return config.driver === "sendgrid" ? new SendGridMailer(config) : new NoopMailer();
}
