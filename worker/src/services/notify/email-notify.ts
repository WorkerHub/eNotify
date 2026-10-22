import type { Env } from "../../types";
import { isValidEmail, sendSmtpMail } from "../email";
import type { NotifyMessage } from "./index";

interface EmailNotifyConfig {
  to: string;
  from_name?: string;
  smtp_host?: string;
  smtp_port?: string;
  smtp_username?: string;
  smtp_password?: string;
  smtp_from?: string;
}

const DEFAULT_SMTP_PORT = 587;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function sendNotifyEmail(
  configJson: string,
  message: NotifyMessage,
  // Kept for the channel-sender signature; this channel reads only per-user
  // config and never the global `Env` settings.
  _env: Env,
): Promise<{ success: boolean; error?: string }> {
  const config: EmailNotifyConfig = JSON.parse(configJson);
  if (!config.to) {
    return { success: false, error: "Email recipient required" };
  }

  if (/[\r\n,;<>]/.test(config.to) || !isValidEmail(config.to)) {
    return { success: false, error: "Invalid email recipient" };
  }

  // Per-user SMTP only: never fall back to the global system mailer.
  const host = config.smtp_host?.trim();
  if (!host) {
    return { success: false, error: "Email channel SMTP not configured" };
  }

  const rawPort = config.smtp_port?.trim();
  const port = rawPort ? Number(rawPort) : DEFAULT_SMTP_PORT;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    return { success: false, error: "Invalid Email channel SMTP port" };
  }

  const from = (config.smtp_from || config.smtp_username || "").trim();
  if (!from || /[\s\r\n,;<>]/.test(from)) {
    return {
      success: false,
      error:
        "Invalid Email channel SMTP sender (set smtp_from or smtp_username)",
    };
  }

  const safeTitle = escapeHtml(message.title);
  const safeBody = escapeHtml(message.body).replace(/\n/g, "<br>");

  return sendSmtpMail(
    {
      host,
      port,
      username: config.smtp_username || "",
      password: config.smtp_password || "",
      from,
      from_name: config.from_name || "",
      secure: port === 465,
    },
    {
      to: config.to,
      subject: message.title.replace(/[\r\n]+/g, " "),
      html: `<h2>${safeTitle}</h2><p>${safeBody}</p>`,
      fromName: config.from_name?.replace(/[<>"\r\n]/g, "").trim() || undefined,
    },
  );
}
