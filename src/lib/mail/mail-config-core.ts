/**
 * Validation for the mail environment, checked once at startup.
 *
 * Pure and free of `server-only` so the rules are unit tested directly
 * (tests/mail-config-core.test.ts) rather than only by starting a misconfigured app.
 *
 * This exists because of a real failure. A deployment had MAIL_DRIVER=sendgrid with none of
 * the supporting variables, and the only evidence was a [FAILED] row in channel_message that
 * nobody looks at. The app came up healthy, forwarding worked, and the emails simply never
 * arrived. Borrowed from SIHL LMS, which validates the same set as its service boots.
 */

export interface MailConfigLike {
  driver: "noop" | "sendgrid";
  apiKey: string | undefined;
  from: string | undefined;
  appUrl: string;
}

/** Deliberately cheap: enough to catch a placeholder or a name typed where an address goes. */
function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/**
 * What is wrong with this mail configuration, as a list of sentences.
 *
 * Only ever complains when the driver is `sendgrid`. An unset MAIL_DRIVER is a supported
 * state — development, CI, and any environment that genuinely does not send — and must stay
 * silent, or every developer gets a startup error for a feature they are not using.
 */
export function validateMailConfig(config: MailConfigLike): string[] {
  if (config.driver !== "sendgrid") return [];

  const problems: string[] = [];

  if (!config.apiKey?.trim()) {
    problems.push("SENDGRID_API_KEY is missing.");
  } else if (!config.apiKey.startsWith("SG.")) {
    // Not a security check — it catches a pasted placeholder or a truncated value, which is
    // the realistic mistake.
    problems.push("SENDGRID_API_KEY does not look like a SendGrid key (expected it to start with 'SG.').");
  }

  if (!config.from?.trim()) {
    problems.push("MAIL_FROM is missing. It must be an address verified as a sender in SendGrid.");
  } else if (!looksLikeEmail(config.from)) {
    problems.push(`MAIL_FROM is not an email address: ${config.from}`);
  }

  // Checked because the default is localhost: left unset in a deployed environment, every
  // "Open ticket" link in every email points at a machine the recipient does not have.
  // The host must END at localhost — an optional port, then a slash or nothing. A `\b`
  // here would also match localhost.sihl.in, which is a perfectly real hostname.
  if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(config.appUrl)) {
    problems.push(
      `MAIL_APP_URL still points at ${config.appUrl}, so every link in every email would be unreachable. Set it to this environment's address.`
    );
  }

  return problems;
}

/** The startup message, or null when there is nothing to say. */
export function describeMailConfigProblems(problems: string[]): string | null {
  if (problems.length === 0) return null;
  return (
    "MAIL_DRIVER=sendgrid, but the mail configuration is incomplete:\n" +
    problems.map((p) => `  - ${p}`).join("\n") +
    "\n\nEither finish the configuration or unset MAIL_DRIVER to disable outbound email. " +
    "Leaving it half-set means every email silently fails and only shows up as a FAILED row " +
    "in channel_message."
  );
}
