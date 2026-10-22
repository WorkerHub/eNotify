import { getSetting } from "../db/queries/settings";
import type { Env } from "../types";
import { getTablePrefix } from "../types";
import { sendSmtpMessage } from "./smtp-transport";

const EMAIL_RE =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email) && !email.includes("\r") && !email.includes("\n");
}

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  from?: string;
  fromName?: string;
}

interface SMTPConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  from: string;
  from_name: string;
  secure: boolean;
}

interface ResendConfig {
  api_key: string;
  from: string;
  from_name: string;
}

export async function sendEmail(
  env: Env,
  options: EmailOptions,
): Promise<{ success: boolean; error?: string }> {
  if (!isValidEmail(options.to)) {
    return { success: false, error: "Invalid recipient email address" };
  }

  const prefix = getTablePrefix(env);
  const provider = await getSetting(env.DB, prefix, "email_provider");

  if (!provider || provider === "none") {
    return { success: false, error: "No email provider configured" };
  }

  if (provider === "resend") {
    return sendViaResend(env, options);
  }

  if (provider === "smtp") {
    return sendViaSMTP(env, options);
  }

  return { success: false, error: `Unknown email provider: ${provider}` };
}

async function sendViaResend(
  env: Env,
  options: EmailOptions,
): Promise<{ success: boolean; error?: string }> {
  const prefix = getTablePrefix(env);
  const configStr = await getSetting(env.DB, prefix, "resend_config");
  if (!configStr) return { success: false, error: "Resend not configured" };

  const config: ResendConfig = JSON.parse(configStr);
  if (!config.api_key)
    return { success: false, error: "Resend API key not configured" };

  const from = options.from || config.from || "noreply@example.com";
  const fromName = (options.fromName || config.from_name || "eNotify").replace(
    /[\r\n]/g,
    "",
  );

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.api_key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `${fromName} <${from}>`,
      to: [options.to],
      subject: options.subject,
      html: options.html,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    return { success: false, error: `Resend error: ${err}` };
  }

  return { success: true };
}

async function sendViaSMTP(
  env: Env,
  options: EmailOptions,
): Promise<{ success: boolean; error?: string }> {
  const prefix = getTablePrefix(env);
  const configStr = await getSetting(env.DB, prefix, "smtp_config");
  if (!configStr) return { success: false, error: "SMTP not configured" };

  const config: SMTPConfig = JSON.parse(configStr);
  if (!config.host)
    return { success: false, error: "SMTP host not configured" };

  return sendSmtpMessage(
    {
      host: config.host,
      port: config.port,
      username: config.username,
      password: config.password,
    },
    {
      to: options.to,
      subject: options.subject,
      html: options.html,
      from: options.from || config.from || "noreply@example.com",
      fromName: options.fromName || config.from_name || "eNotify",
    },
  );
}
