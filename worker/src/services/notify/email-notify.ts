import type { Env } from "../../types";
import { isValidEmail } from "../email";
import { sendSmtpMessage } from "../smtp-transport";
import type { NotifyMessage } from "./index";

// Per-user Email channel config, stored in `notification_configs.email_config`.
// Delivery always uses the user's own SMTP server; the global email settings
// (settings table: email_provider / smtp_config / resend_config) are never read
// here, and there is no fallback to the system mail path.
interface EmailNotifyConfig {
  to?: string;
  from_name?: string;
  smtp_host?: string;
  smtp_port?: string | number;
  smtp_username?: string;
  smtp_password?: string;
  smtp_from?: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** `smtp_port` is stored as a string in the JSON config; SMTP needs a number. */
function parsePort(raw: string | number | undefined): number | null {
  if (raw === undefined || raw === null) return null;
  const text = String(raw).trim();
  if (!text) return null;
  const port = Number(text);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return port;
}

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

/**
 * Header/envelope injection guards. `to` and `from` both end up verbatim in
 * `MAIL FROM:`/`RCPT TO:` and in message headers, so they are validated the
 * same way.
 */
function hasInjectionChars(value: string): boolean {
  return /[\r\n,;<>]/.test(value);
}

/** Conservative hostname / IPv4 / bracketed IPv6 check (no spaces, no userinfo). */
function isValidSmtpHost(host: string): boolean {
  return /^[A-Za-z0-9._\-:[\]]+$/.test(host);
}

export async function sendNotifyEmail(
  configJson: string,
  message: NotifyMessage,
  _env: Env,
): Promise<{ success: boolean; error?: string }> {
  let config: EmailNotifyConfig;
  try {
    config = JSON.parse(configJson);
  } catch {
    return { success: false, error: "Invalid email config" };
  }

  const to = clean(config.to);
  if (!to) {
    return { success: false, error: "Email recipient required" };
  }

  if (hasInjectionChars(to)) {
    return { success: false, error: "Invalid email recipient" };
  }

  if (!isValidEmail(to)) {
    return { success: false, error: "Invalid recipient email address" };
  }

  const host = clean(config.smtp_host);
  if (!host) {
    return { success: false, error: "Email channel SMTP not configured" };
  }

  if (!isValidSmtpHost(host)) {
    return { success: false, error: "Invalid Email channel SMTP host" };
  }

  const port = parsePort(config.smtp_port);
  if (port === null) {
    return { success: false, error: "Invalid Email channel SMTP port" };
  }

  const username = clean(config.smtp_username);
  const password = config.smtp_password ?? "";
  // `from` comes from the user's own config only — never a shared default.
  const from = clean(config.smtp_from) || username;
  if (!from) {
    return {
      success: false,
      error:
        "Invalid Email channel SMTP sender (set smtp_from or smtp_username)",
    };
  }

  // `from` lands in `MAIL FROM:<…>` and the `From:` header, so it gets the same
  // injection + format validation as `to`.
  if (hasInjectionChars(from) || !isValidEmail(from)) {
    return {
      success: false,
      error: "Invalid Email channel SMTP sender address",
    };
  }
  const fromName = clean(config.from_name)
    .replace(/[<>"\r\n]/g, "")
    .trim();

  const safeTitle = escapeHtml(message.title);
  const safeBody = escapeHtml(message.body).replace(/\n/g, "<br>");

  return sendSmtpMessage(
    { host, port, username, password },
    {
      to,
      subject: message.title.replace(/[\r\n]+/g, " "),
      html: `<h2>${safeTitle}</h2><p>${safeBody}</p>`,
      from,
      fromName: fromName || undefined,
    },
  );
}
